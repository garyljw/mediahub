import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJpeg } from "./arr/poster";
import { ArrRequestError } from "./arr/request";
import { env } from "./env";
import { getConnection, type ArrApp } from "./settings/connections";

/**
 * Disk cache for images MediaHub fetches from Radarr, Sonarr, TMDB and TVDB. A cached image is served without an
 * upstream call until it is older than the TTL the caller passes. Files live in a directory next to the database.
 */

/** Library posters and backdrops can be changed in Radarr/Sonarr, so they are refreshed weekly. */
export const ARR_IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** TMDB and TVDB files are content-addressed and rarely change, so they are kept a month. */
export const LOOKUP_IMAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Total size the cache may take up before old files are pruned. */
export const MAX_CACHE_BYTES = 500 * 1024 * 1024;

/** Prune runs at most this often, and only after a successful write. */
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
/** After an upstream failure is answered with a stale copy, the copy is served without retrying for this long. */
const STALE_RETRY_MS = 10 * 60 * 1000;
/** Leftover temp files from an interrupted write are removed after this long. */
const TMP_MAX_AGE_MS = 60 * 60 * 1000;

// Owner-only modes, same as db/index.ts. The umask can only remove bits, so these are never looser.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

let dirOverride: string | undefined;

/** Tests point the cache at a temp directory. Pass undefined to go back to the real location. */
export function setImageCacheDirForTests(dir: string | undefined): void {
  dirOverride = dir;
}

/** Next to the SQLite file, e.g. ./data/image-cache when DATABASE_PATH is ./data/mediahub.db. */
function cacheDir(): string {
  if (dirOverride) return dirOverride;
  // turbopackIgnore stops Next's file tracing from treating this as a reference to ./data/image-cache and
  // copying the real cached posters into the standalone build.
  return path.join(/*turbopackIgnore: true*/ path.dirname(path.resolve(env().DATABASE_PATH)), "image-cache");
}

/** The file name is a hash of the key, so the key (which can contain an Arr URL) never becomes part of a path. */
function fileNameFor(key: string): string {
  return `${createHash("sha256").update(key).digest("hex")}.jpg`;
}

/** Loads that are in progress, keyed by file name. Concurrent callers for the same image share one load. */
const inFlight = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

let lastPruneAt = 0;

/**
 * Returns the image for `key`. A cached copy younger than `ttlMs` is returned without calling `fetchFresh`.
 * Otherwise `fetchFresh` runs and its result is written to the cache. If the upstream fails with a non-404
 * ArrRequestError and a stale copy exists, the stale copy is returned. A 404 removes the cached copy and rethrows.
 */
export async function cachedImage(
  key: string,
  ttlMs: number,
  fetchFresh: () => Promise<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array<ArrayBuffer>> {
  const dir = cacheDir();
  const name = fileNameFor(key);
  const file = path.join(/*turbopackIgnore: true*/ dir, name);

  let job = inFlight.get(name);
  if (!job) {
    job = load(dir, file, ttlMs, fetchFresh).finally(() => inFlight.delete(name));
    inFlight.set(name, job);
  }
  return job;
}

/**
 * A Radarr or Sonarr cover image (poster or backdrop) for one item, through the cache. The key includes the saved
 * connection URL, so a different instance never gets another instance's images. With no saved connection, `fetchFresh`
 * runs uncached and reports the missing connection itself.
 */
export async function cachedArrImage(
  app: ArrApp,
  kind: "poster" | "backdrop",
  id: number,
  fetchFresh: () => Promise<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array<ArrayBuffer>> {
  const connection = getConnection(app);
  if (!connection) return fetchFresh();
  return cachedImage(`${app}|${connection.url}|${kind}|${id}`, ARR_IMAGE_TTL_MS, fetchFresh);
}

async function load(
  dir: string,
  file: string,
  ttlMs: number,
  fetchFresh: () => Promise<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array<ArrayBuffer>> {
  const cached = await readCached(file);
  if (cached && Date.now() - cached.mtimeMs < ttlMs) return cached.bytes;

  let fresh: Uint8Array<ArrayBuffer>;
  try {
    fresh = await fetchFresh();
  } catch (error) {
    if (error instanceof ArrRequestError) {
      if (error.status === 404) {
        await removeQuietly(file);
        throw error;
      }
      // Any other upstream failure: serve the stale copy if there is one. The message is not logged here.
      // Its mtime is moved so it counts as fresh for STALE_RETRY_MS, so an outage doesn't cost a timeout per request.
      if (cached) {
        await backOff(file, ttlMs);
        return cached.bytes;
      }
    }
    throw error;
  }

  await storeFresh(dir, file, fresh);
  return fresh;
}

/** Dates a stale file so it reads as fresh for STALE_RETRY_MS more. Failure only means the next request retries. */
async function backOff(file: string, ttlMs: number): Promise<void> {
  const seconds = (Date.now() - ttlMs + Math.min(STALE_RETRY_MS, ttlMs)) / 1000;
  try {
    await utimes(/*turbopackIgnore: true*/ file, seconds, seconds);
  } catch {
    // Ignored on purpose, see above.
  }
}

/** Reads a cached file. Returns null when it is missing, unreadable or not a JPEG (a non-JPEG file is deleted). */
async function readCached(file: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; mtimeMs: number } | null> {
  let bytes: Uint8Array<ArrayBuffer>;
  let mtimeMs: number;
  try {
    const info = await stat(/*turbopackIgnore: true*/ file);
    mtimeMs = info.mtimeMs;
    bytes = new Uint8Array(await readFile(/*turbopackIgnore: true*/ file));
  } catch {
    return null;
  }
  if (!isJpeg(bytes)) {
    await removeQuietly(file);
    return null;
  }
  return { bytes, mtimeMs };
}

/**
 * Writes a fresh image atomically: a temp file with owner-only mode, then a rename onto the final name. A failure
 * is logged without the path or key and does not fail the request.
 */
async function storeFresh(dir: string, file: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const tmp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    // A missing directory is created owner-only. An existing one keeps its mode, as in db/index.ts.
    await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true, mode: DIR_MODE });
    await writeFile(/*turbopackIgnore: true*/ tmp, bytes, { mode: FILE_MODE });
    await rename(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ file);
  } catch {
    console.error("[image-cache] write failed");
    await removeQuietly(tmp);
    return;
  }
  schedulePrune(dir);
}

/** Starts a prune in the background, at most once per PRUNE_INTERVAL_MS. Errors are logged and never reach the caller. */
function schedulePrune(dir: string): void {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  void pruneImageCache(dir, MAX_CACHE_BYTES).catch(() => {
    console.error("[image-cache] prune failed");
  });
}

/**
 * Removes leftover temp files older than an hour. Then, if the JPEG files add up to more than `maxBytes`, deletes
 * the oldest-modified ones until the total is at most 90% of `maxBytes`. Exported for tests.
 */
export async function pruneImageCache(dir: string, maxBytes: number): Promise<void> {
  const names = await readdir(/*turbopackIgnore: true*/ dir);
  const now = Date.now();
  const files: { file: string; size: number; mtimeMs: number }[] = [];
  let total = 0;

  for (const name of names) {
    const file = path.join(/*turbopackIgnore: true*/ dir, name);
    if (name.endsWith(".tmp")) {
      const info = await stat(/*turbopackIgnore: true*/ file).catch(() => null);
      if (info && now - info.mtimeMs > TMP_MAX_AGE_MS) await removeQuietly(file);
      continue;
    }
    if (!name.endsWith(".jpg")) continue;
    const info = await stat(/*turbopackIgnore: true*/ file).catch(() => null);
    if (!info) continue;
    files.push({ file, size: info.size, mtimeMs: info.mtimeMs });
    total += info.size;
  }

  if (total <= maxBytes) return;
  const target = maxBytes * 0.9;
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const entry of files) {
    if (total <= target) break;
    await removeQuietly(entry.file);
    total -= entry.size;
  }
}

/** Deletes a file and ignores the error (for example, it is already gone). */
async function removeQuietly(file: string): Promise<void> {
  try {
    await unlink(/*turbopackIgnore: true*/ file);
  } catch {
    // Already gone, or not removable. Either way there is nothing more to do.
  }
}

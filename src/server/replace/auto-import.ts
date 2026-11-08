import "server-only";
import { fetchEpisodeHistory, fetchMovieHistory } from "@/server/arr/history";
import { fetchEpisodeQueue, fetchMovieQueue, type EpisodeQueueItem, type MovieQueueItem } from "@/server/arr/queue";
import {
  fetchEpisodeManualImport,
  fetchMovieManualImport,
  startEpisodeManualImport,
  startMovieManualImport,
} from "@/server/arr/manual-import";
import { ArrRequestError } from "@/server/arr/request";
import { canManualImport, pickEpisodeImportFiles, pickMovieImportFiles } from "@/server/merge/manual-import";
import {
  matchedByIdFileIds,
  RADARR_MATCHED_BY_ID_PREFIX,
  replaceableFileIds,
  SONARR_MATCHED_BY_ID_PREFIX,
} from "@/server/merge/replace-import";
import { readAutoImportMatchedById } from "@/server/settings/auto-import";
import {
  deleteReplaceGrab,
  pendingReplaceGrabs,
  setReplaceDownloadId,
  type PendingReplaceGrab,
  type ReplaceApp,
} from "./replace-grabs";

// Each run does two jobs, both sending the same ManualImport command that Force import uses.
// 1. Replace: for the grabs an admin made with "Replace existing file" ticked, it finds each grab's download id in the
//    app's history, and once the download is finished and Radarr or Sonarr won't import it only because it isn't an
//    upgrade, it imports the files that are just not an upgrade. A grab whose download has left the queue is forgotten.
// 2. Matched by ID (only when the Settings switch is on): a finished download that Radarr or Sonarr blocks because it
//    was matched to its movie or series by ID is imported, but only the files that are clean and belong to that movie
//    or series. See matchedByIdFileIds.

/** How often the worker runs. Set in startReplaceImportTimer. */
export const REPLACE_IMPORT_INTERVAL_MS = 2 * 60_000;

/** How many of the newest grabbed events the history read asks for. A grab's record is near the top. */
const HISTORY_LIMIT = 100;
/** How long a grab may go without its download id turning up in the newest grabbed records before it is forgotten. */
const RESOLVE_GIVE_UP_MS = 60 * 60_000;
/** How old a grab must be before its absence from the queue means the download has left it. */
const QUEUE_GRACE_MS = 10 * 60_000;
/** Radarr's and Sonarr's history event type for a grab (eventType 1 in both apps). */
const GRABBED_EVENT = 1;

const APPS: readonly ReplaceApp[] = ["radarr", "sonarr"];
const APP_NAMES: Record<ReplaceApp, "Radarr" | "Sonarr"> = { radarr: "Radarr", sonarr: "Sonarr" };

/** A history record, as far as this file reads it. The release guid is in data, which the apps send as text values. */
type GrabRecord = { downloadId?: string | null; data?: { [key: string]: string | null } | null };

/** Set while a run is in progress, so two runs never overlap. */
let running = false;

type QueueItem = MovieQueueItem | EpisodeQueueItem;

// Next's dev server reloads modules, so the set of matched-by-ID downloads already decided is kept on globalThis under a
// shared symbol, as the timer flag is. Each download is decided once per process, so it is never sent twice.
const ATTEMPTED_KEY = Symbol.for("mediahub.autoImportAttempted");
const globalWithAttempted = globalThis as typeof globalThis & { [ATTEMPTED_KEY]?: Set<string> };

/** The download ids the matched-by-ID path has already decided on in this process. */
function attemptedMatchedById(): Set<string> {
  let attempted = globalWithAttempted[ATTEMPTED_KEY];
  if (!attempted) {
    attempted = new Set<string>();
    globalWithAttempted[ATTEMPTED_KEY] = attempted;
  }
  return attempted;
}

/** The download id of the newest grabbed record for this release guid, skipping records with no usable download id. */
function downloadIdForGuid(records: readonly GrabRecord[], guid: string): string | null {
  for (const record of records) {
    if (record.data?.guid !== guid) continue;
    const downloadId = record.downloadId;
    if (typeof downloadId === "string" && downloadId.trim() !== "") return downloadId;
  }
  return null;
}

/** Looks up the download id of each grab that doesn't have one yet, from one history read for the app. */
async function resolveDownloadIds(app: ReplaceApp, rows: PendingReplaceGrab[], now: number): Promise<void> {
  const unresolved = rows.filter((row) => row.downloadId === null);
  if (unresolved.length === 0) return;
  const page =
    app === "radarr"
      ? await fetchMovieHistory(HISTORY_LIMIT, [GRABBED_EVENT])
      : await fetchEpisodeHistory(HISTORY_LIMIT, [GRABBED_EVENT]);
  for (const row of unresolved) {
    const downloadId = downloadIdForGuid(page.records, row.guid);
    if (downloadId !== null) {
      setReplaceDownloadId(row.id, downloadId);
      row.downloadId = downloadId;
    } else if (now - row.createdAt >= RESOLVE_GIVE_UP_MS) {
      // Still not in the newest grabbed records after an hour, so it never will be. Stop reading history for it.
      deleteReplaceGrab(row.id);
      console.log(`Replace import: couldn't find a remembered grab in ${APP_NAMES[app]}'s history, so it was forgotten.`);
    }
  }
}

/**
 * Scans one download and plans the ManualImport command for its files that are only "not an upgrade". Returns how
 * many files the command holds and a function that sends it, or "needs-attention" when no file qualifies or the picked
 * files can't be imported. Nothing is sent here.
 */
async function planImportOverExisting(
  app: ReplaceApp,
  downloadId: string,
  expectedId: number | null,
): Promise<{ count: number; send: () => Promise<void> } | "needs-attention"> {
  // Every scanned file must belong to the movie or series the queue item names, so a replace never overwrites a
  // different title's file. matchedByIdFileIds refuses the whole download when any file belongs elsewhere.
  if (expectedId === null) return "needs-attention";
  if (app === "radarr") {
    const items = await fetchMovieManualImport(downloadId);
    if (!matchedByIdFileIds(items, expectedId).ok) return "needs-attention";
    const ids = replaceableFileIds(items);
    if (ids.length === 0) return "needs-attention";
    const picked = pickMovieImportFiles(items, ids, downloadId);
    if (!picked.ok || picked.files.length === 0) return "needs-attention";
    const files = picked.files;
    return { count: files.length, send: () => startMovieManualImport(files) };
  }
  const items = await fetchEpisodeManualImport(downloadId);
  if (!matchedByIdFileIds(items, expectedId).ok) return "needs-attention";
  const ids = replaceableFileIds(items);
  if (ids.length === 0) return "needs-attention";
  const picked = pickEpisodeImportFiles(items, ids, downloadId);
  if (!picked.ok || picked.files.length === 0) return "needs-attention";
  const files = picked.files;
  return { count: files.length, send: () => startEpisodeManualImport(files) };
}

/**
 * One app's queue, read once per run. Top-level items only: the nested movie, series and episode objects aren't needed
 * to match a download, and the top-level movieId or seriesId says which movie or series it is.
 */
async function readQueue(app: ReplaceApp): Promise<QueueItem[]> {
  return app === "radarr"
    ? fetchMovieQueue({ includeMovie: false })
    : fetchEpisodeQueue({ includeSeries: false, includeEpisode: false });
}

/** Works through one app's remembered grabs, then (when the switch is on) its matched-by-ID downloads. */
async function processApp(app: ReplaceApp, rows: PendingReplaceGrab[], now: number, matchedOn: boolean): Promise<void> {
  try {
    await resolveDownloadIds(app, rows, now);
  } catch (error) {
    // A history failure only delays the replace grabs; the queue work below (and matched by ID) still runs.
    if (!(error instanceof ArrRequestError) || error.kind === "unconfigured") throw error;
    console.error(`Auto import: ${error.message}`);
  }
  const tracked = rows.flatMap((row) => (row.downloadId === null ? [] : [{ row, downloadId: row.downloadId }]));
  if (tracked.length === 0 && !matchedOn) return;

  const queue = await readQueue(app);
  // Downloads the replace path forgot this run. The matched-by-ID path leaves them alone.
  const handled = new Set<string>();

  for (const { row, downloadId } of tracked) {
    const items = queue.filter((item) => item.downloadId === downloadId);
    if (items.length === 0) {
      // Gone from the queue: imported normally, or removed. A fresh grab may not be listed yet, because the app
      // refreshes its queue on its own schedule, so only a grab older than QUEUE_GRACE_MS counts as gone.
      if (now - row.createdAt >= QUEUE_GRACE_MS) deleteReplaceGrab(row.id);
      continue;
    }
    // Still downloading, or finished without a warning: wait.
    if (!items.some((item) => canManualImport(item))) continue;

    const blocked = items.find((item) => canManualImport(item)) ?? items[0];
    const plan = await planImportOverExisting(app, downloadId, expectedIdOf(app, blocked));
    // Either way MediaHub is done with this grab, so it is forgotten before anything is sent. A command that times out
    // may still have been queued, and must never be sent a second time on the next run.
    deleteReplaceGrab(row.id);
    handled.add(downloadId);
    if (plan === "needs-attention") {
      // Something other than "not an upgrade" blocks it (a sample, a wrong episode). Logged once; Force import remains.
      console.log(`Replace import: a download needs a manual import in ${APP_NAMES[app]}.`);
      continue;
    }
    await plan.send();
    console.log(`Replace import: sent ${plan.count} file(s) to ${APP_NAMES[app]}.`);
  }

  if (matchedOn) await processMatchedById(app, queue, handled);
}

/** The prefix Radarr or Sonarr puts on a matched-by-ID block, for this app. */
function matchedByIdPrefix(app: ReplaceApp): string {
  return app === "radarr" ? RADARR_MATCHED_BY_ID_PREFIX : SONARR_MATCHED_BY_ID_PREFIX;
}

/** True when a queue item is blocked only because its release was matched to its movie or series by ID. */
function isMatchedById(app: ReplaceApp, item: QueueItem): boolean {
  const prefix = matchedByIdPrefix(app);
  return (item.statusMessages ?? []).some((status) =>
    (status.messages ?? []).some((message) => message.startsWith(prefix)),
  );
}

/** The movie id (Radarr) or series id (Sonarr) a queue item names, when it is a positive integer, else null. */
function expectedIdOf(app: ReplaceApp, item: QueueItem): number | null {
  // The queue read for each app returns that app's own items, so the cast names the id that app's queue carries.
  const id = app === "radarr" ? (item as MovieQueueItem).movieId : (item as EpisodeQueueItem).seriesId;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Scans one matched-by-ID download and plans the ManualImport command for its clean files that belong to expectedId.
 * Returns how many files the command holds and a function that sends it, or "needs-attention" when nothing can be
 * imported safely. Nothing is sent here.
 */
async function planMatchedById(
  app: ReplaceApp,
  downloadId: string,
  expectedId: number,
): Promise<{ count: number; send: () => Promise<void> } | "needs-attention"> {
  if (app === "radarr") {
    const items = await fetchMovieManualImport(downloadId);
    const matched = matchedByIdFileIds(items, expectedId);
    if (!matched.ok || matched.ids.length === 0) return "needs-attention";
    const picked = pickMovieImportFiles(items, matched.ids, downloadId);
    if (!picked.ok || picked.files.length === 0) return "needs-attention";
    const files = picked.files;
    return { count: files.length, send: () => startMovieManualImport(files) };
  }
  const items = await fetchEpisodeManualImport(downloadId);
  const matched = matchedByIdFileIds(items, expectedId);
  if (!matched.ok || matched.ids.length === 0) return "needs-attention";
  const picked = pickEpisodeImportFiles(items, matched.ids, downloadId);
  if (!picked.ok || picked.files.length === 0) return "needs-attention";
  const files = picked.files;
  return { count: files.length, send: () => startEpisodeManualImport(files) };
}

/**
 * Imports the finished downloads that Radarr or Sonarr blocked as matched by ID. One download gets one decision: it is
 * recorded before anything is sent, so a failed command is never sent again. A download the replace path forgot this run
 * is skipped.
 */
async function processMatchedById(app: ReplaceApp, queue: QueueItem[], handled: Set<string>): Promise<void> {
  const attempted = attemptedMatchedById();
  // The first queue item of each download that qualifies names its movie or series. A download's items share one.
  const candidates = new Map<string, QueueItem>();
  for (const item of queue) {
    if (!canManualImport(item) || !isMatchedById(app, item)) continue;
    const downloadId = item.downloadId;
    if (typeof downloadId !== "string" || downloadId.trim() === "") continue;
    if (!candidates.has(downloadId)) candidates.set(downloadId, item);
  }

  for (const [downloadId, item] of candidates) {
    if (handled.has(downloadId) || attempted.has(downloadId)) continue;
    const expectedId = expectedIdOf(app, item);
    if (expectedId === null) {
      attempted.add(downloadId);
      console.log(`Auto import: a download matched by ID needs a manual import in ${APP_NAMES[app]}.`);
      continue;
    }

    const plan = await planMatchedById(app, downloadId, expectedId);
    // Recorded before the command is sent, and before a "needs attention" is logged, so each is decided once.
    attempted.add(downloadId);
    if (plan === "needs-attention") {
      console.log(`Auto import: a download matched by ID needs a manual import in ${APP_NAMES[app]}.`);
      continue;
    }
    await plan.send();
    console.log(`Auto import: sent ${plan.count} file(s) matched by ID to ${APP_NAMES[app]}.`);
  }
}

/**
 * One run of the worker. Does nothing when no grab is remembered and the matched-by-ID switch is off, so an idle MediaHub
 * makes no Radarr or Sonarr requests. An app that isn't set up is skipped. Another failure from an app's request is
 * logged, and the rows stay for the next run. Any other error is thrown. A call made while a run is in progress returns
 * at once.
 */
export async function runAutoImports(now = Date.now()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const pending = pendingReplaceGrabs(now);
    const matchedOn = readAutoImportMatchedById();
    for (const app of APPS) {
      const rows = pending.filter((row) => row.app === app);
      if (rows.length === 0 && !matchedOn) continue;
      try {
        await processApp(app, rows, now, matchedOn);
      } catch (error) {
        if (!(error instanceof ArrRequestError)) throw error;
        // Not set up yet: nothing to do, and no need to log it every run.
        if (error.kind === "unconfigured") continue;
        // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
        console.error(`Auto import: ${error.message}`);
      }
    }
  } finally {
    running = false;
  }
}

// Next's dev server reloads modules, and a bundle can be loaded twice. Keeping the flag on globalThis under a shared
// symbol means the timer is started once per process, as release-cache.ts does for its cache.
const TIMER_KEY = Symbol.for("mediahub.replaceImportTimer");
const globalWithTimer = globalThis as typeof globalThis & { [TIMER_KEY]?: boolean };

/** Starts the worker on an interval, once per process. The timer doesn't keep the process alive. */
export function startReplaceImportTimer(): void {
  if (globalWithTimer[TIMER_KEY]) return;
  globalWithTimer[TIMER_KEY] = true;
  const timer = setInterval(() => {
    runAutoImports().catch((error: unknown) => {
      console.error(`Replace import: ${error instanceof Error ? error.name : "error"}`);
    });
  }, REPLACE_IMPORT_INTERVAL_MS);
  timer.unref();
}

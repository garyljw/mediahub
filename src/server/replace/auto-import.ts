import "server-only";
import { fetchEpisodeHistory, fetchMovieHistory } from "@/server/arr/history";
import { fetchEpisodeQueue, fetchMovieQueue } from "@/server/arr/queue";
import {
  fetchEpisodeManualImport,
  fetchMovieManualImport,
  startEpisodeManualImport,
  startMovieManualImport,
} from "@/server/arr/manual-import";
import { ArrRequestError } from "@/server/arr/request";
import { canManualImport, pickEpisodeImportFiles, pickMovieImportFiles } from "@/server/merge/manual-import";
import { replaceableFileIds } from "@/server/merge/replace-import";
import {
  deleteReplaceGrab,
  pendingReplaceGrabs,
  setReplaceDownloadId,
  type PendingReplaceGrab,
  type ReplaceApp,
} from "./replace-grabs";

// Imports a download over the existing file, for the grabs an admin made with "Replace existing file" ticked. Each run
// looks at the remembered grabs: it finds each one's download id in the app's history, and once the download is finished
// and Radarr or Sonarr won't import it only because it isn't an upgrade, it sends the same ManualImport command that
// Force import uses. A grab whose download has left the queue is forgotten.

/** How often the worker runs. Set in startReplaceImportTimer. */
export const REPLACE_IMPORT_INTERVAL_MS = 2 * 60_000;

/** How many of the newest grabbed events the history read asks for. A grab's record is near the top. */
const HISTORY_LIMIT = 100;
/** Radarr's and Sonarr's history event type for a grab (eventType 1 in both apps). */
const GRABBED_EVENT = 1;

const APPS: readonly ReplaceApp[] = ["radarr", "sonarr"];
const APP_NAMES: Record<ReplaceApp, "Radarr" | "Sonarr"> = { radarr: "Radarr", sonarr: "Sonarr" };

/** A history record, as far as this file reads it. The release guid is in data, which the apps send as text values. */
type GrabRecord = { downloadId?: string | null; data?: { [key: string]: string | null } | null };

/** Set while a run is in progress, so two runs never overlap. */
let running = false;

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
async function resolveDownloadIds(app: ReplaceApp, rows: PendingReplaceGrab[]): Promise<void> {
  const unresolved = rows.filter((row) => row.downloadId === null);
  if (unresolved.length === 0) return;
  const page =
    app === "radarr"
      ? await fetchMovieHistory(HISTORY_LIMIT, [GRABBED_EVENT])
      : await fetchEpisodeHistory(HISTORY_LIMIT, [GRABBED_EVENT]);
  for (const row of unresolved) {
    const downloadId = downloadIdForGuid(page.records, row.guid);
    if (downloadId === null) continue;
    setReplaceDownloadId(row.id, downloadId);
    row.downloadId = downloadId;
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
): Promise<{ count: number; send: () => Promise<void> } | "needs-attention"> {
  if (app === "radarr") {
    const items = await fetchMovieManualImport(downloadId);
    const ids = replaceableFileIds(items);
    if (ids.length === 0) return "needs-attention";
    const picked = pickMovieImportFiles(items, ids, downloadId);
    if (!picked.ok || picked.files.length === 0) return "needs-attention";
    const files = picked.files;
    return { count: files.length, send: () => startMovieManualImport(files) };
  }
  const items = await fetchEpisodeManualImport(downloadId);
  const ids = replaceableFileIds(items);
  if (ids.length === 0) return "needs-attention";
  const picked = pickEpisodeImportFiles(items, ids, downloadId);
  if (!picked.ok || picked.files.length === 0) return "needs-attention";
  const files = picked.files;
  return { count: files.length, send: () => startEpisodeManualImport(files) };
}

/** Works through one app's remembered grabs. Errors from the app's requests propagate to runReplaceImports. */
async function processApp(app: ReplaceApp, rows: PendingReplaceGrab[]): Promise<void> {
  await resolveDownloadIds(app, rows);
  const tracked = rows.flatMap((row) => (row.downloadId === null ? [] : [{ row, downloadId: row.downloadId }]));
  if (tracked.length === 0) return;

  // Top-level items only: the nested movie, series and episode objects aren't needed to match a download.
  const queue =
    app === "radarr"
      ? await fetchMovieQueue({ includeMovie: false })
      : await fetchEpisodeQueue({ includeSeries: false, includeEpisode: false });

  for (const { row, downloadId } of tracked) {
    const items = queue.filter((item) => item.downloadId === downloadId);
    // Gone from the queue: imported normally, or removed. Nothing left to do.
    if (items.length === 0) {
      deleteReplaceGrab(row.id);
      continue;
    }
    // Still downloading, or finished without a warning: wait.
    if (!items.some((item) => canManualImport(item))) continue;

    const plan = await planImportOverExisting(app, downloadId);
    // Either way MediaHub is done with this grab, so it is forgotten before anything is sent. A command that times out
    // may still have been queued, and must never be sent a second time on the next run.
    deleteReplaceGrab(row.id);
    if (plan === "needs-attention") {
      // Something other than "not an upgrade" blocks it (a sample, a wrong episode). Logged once; Force import remains.
      console.log(`Replace import: a download needs a manual import in ${APP_NAMES[app]}.`);
      continue;
    }
    await plan.send();
    console.log(`Replace import: sent ${plan.count} file(s) to ${APP_NAMES[app]}.`);
  }
}

/**
 * One run of the worker. Does nothing when nothing is remembered, so an idle MediaHub makes no Radarr or Sonarr
 * requests. An app that isn't set up is skipped. Another failure from an app's request is logged, and the rows stay
 * for the next run. Any other error is thrown. A call made while a run is in progress returns at once.
 */
export async function runReplaceImports(now = Date.now()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const pending = pendingReplaceGrabs(now);
    for (const app of APPS) {
      const rows = pending.filter((row) => row.app === app);
      if (rows.length === 0) continue;
      try {
        await processApp(app, rows);
      } catch (error) {
        if (!(error instanceof ArrRequestError)) throw error;
        // Not set up yet: nothing to do, and no need to log it every run.
        if (error.kind === "unconfigured") continue;
        // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
        console.error(`Replace import: ${error.message}`);
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
    runReplaceImports().catch((error: unknown) => {
      console.error(`Replace import: ${error instanceof Error ? error.name : "error"}`);
    });
  }, REPLACE_IMPORT_INTERVAL_MS);
  timer.unref();
}

"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import {
  fetchEpisodeQueue,
  fetchMovieQueue,
  removeEpisodeQueueItem,
  removeMovieQueueItem,
} from "@/server/arr/queue";
import {
  fetchEpisodeManualImport,
  fetchMovieManualImport,
  startEpisodeManualImport,
  startMovieManualImport,
} from "@/server/arr/manual-import";
import { ArrRequestError, writeFailureMessage } from "@/server/arr/request";
import {
  canManualImport,
  pickEpisodeImportFiles,
  pickMovieImportFiles,
  toEpisodeImportCandidates,
  toMovieImportCandidates,
  type PickFailure,
} from "@/server/merge/manual-import";
import { firstQueuedId } from "@/server/merge/queue";
import type { ImportCandidate } from "@/components/queue/queue-import";

export type ActionResult = { ok: true } | { ok: false; error: string };

// strictObject rejects unknown keys (including the old single queueId). A row holds one id per episode, so 1000 is generous. The browser sends the row's item ids, and
// they only say which download the admin meant. The server checks them against the app's queue before it acts.
const RemoveInput = z.strictObject({
  app: z.enum(["radarr", "sonarr"]),
  queueIds: z.array(z.number().int().positive()).min(1).max(1000),
  removeFromClient: z.boolean(),
  blocklist: z.boolean(),
  skipRedownload: z.boolean(),
});

/**
 * Removes one Queue row from Radarr or Sonarr (admin only). The action sends ONE queue id upstream, not all of a
 * season pack's ids. Sonarr's QueueController.RemoveMany finds a tracked download from any one of its item ids, and
 * for a pending release it removes every episode the release covers. Sending several ids of a pending pack makes its
 * second lookup fail with HTTP 500. The id is the first of the sent ids (in order) that is still in this app's queue.
 * The role check runs first, inside try, and the catch always returns or throws. src/app/server-actions-auth.test.ts
 * enforces this shape for every action.
 */
export async function removeQueueItem(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to remove downloads." };
    throw error;
  }

  const parsed = RemoveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid change." };
  const { app, queueIds, removeFromClient, blocklist, skipRedownload } = parsed.data;
  const appName = app === "radarr" ? "Radarr" : "Sonarr";

  // Only top-level item ids are needed to find the queued one, so the nested objects are not requested.
  let queuedId: number | null;
  try {
    queuedId =
      app === "radarr"
        ? firstQueuedId(await fetchMovieQueue({ includeMovie: false }), queueIds)
        : firstQueuedId(await fetchEpisodeQueue({ includeSeries: false, includeEpisode: false }), queueIds);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // Nothing has been sent to remove yet, so this failure removes nothing.
    console.error(`Queue remove: ${error.message}`);
    return { ok: false, error: `${appName} didn't answer. Nothing was removed.` };
  }

  if (queuedId === null) {
    // None of the row's ids is queued any more, for example because the download finished. Refreshing removes the row.
    refresh();
    return { ok: false, error: "That download is no longer in the queue." };
  }

  const options = { removeFromClient, blocklist, skipRedownload };
  try {
    // One id only: see the comment above.
    if (app === "radarr") await removeMovieQueueItem(queuedId, options);
    else await removeEpisodeQueueItem(queuedId, options);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Queue remove: ${error.message}`);
    // A timeout or a broken reply can come after the app removed the download, so the user must check first.
    return { ok: false, error: writeFailureMessage(error, appName, { done: "removed", check: "check the queue" }) };
  }

  // The page reads the queue on every request, so refresh() shows the change.
  refresh();
  return { ok: true };
}

const ForceImportLoadInput = z.strictObject({
  app: z.enum(["radarr", "sonarr"]),
  queueIds: z.array(z.number().int().positive()).min(1).max(1000),
});

const ForceImportInput = z.strictObject({
  app: z.enum(["radarr", "sonarr"]),
  queueIds: z.array(z.number().int().positive()).min(1).max(1000),
  fileIds: z.array(z.number().int().positive()).min(1).max(500),
});

export type LoadForceImportResult = { ok: true; files: ImportCandidate[] } | { ok: false; error: string };

const DENIED_IMPORT = "You don't have permission to import downloads.";
const CANNOT_IMPORT = "That download can't be imported right now.";

const PICK_ERRORS: Record<PickFailure, string> = {
  missing: "The files in that download changed. Close this and open Force import again.",
  notImportable: "One of the ticked files can't be imported.",
  duplicateTarget: "Two ticked files are for the same movie or episode. Untick one.",
};

/** The fields of a queue item that the import check reads. Both apps' queue items fit this shape. */
type ImportQueueItem = {
  id?: number | null;
  downloadId?: string | null;
  status?: string | null;
  trackedDownloadStatus?: string | null;
};

/**
 * The download behind the queued row, when it can still be imported. Reads the app's queue fresh, with the nested
 * objects left out. Radarr's row is one item. Sonarr's row is a whole download, so any item of that download counts,
 * as in the Queue merge, which also groups by the exact download id. Throws ArrRequestError when the queue can't be
 * read. This only reads; nothing is written upstream here.
 */
async function importTargetOf(
  app: "radarr" | "sonarr",
  queueIds: number[],
): Promise<{ ok: true; downloadId: string } | { ok: false; error: string }> {
  const items: ImportQueueItem[] =
    app === "radarr"
      ? await fetchMovieQueue({ includeMovie: false })
      : await fetchEpisodeQueue({ includeSeries: false, includeEpisode: false });

  const queuedId = firstQueuedId(items, queueIds);
  const queued = queuedId === null ? undefined : items.find((item) => item.id === queuedId);
  if (queued === undefined) {
    // The row's download has left the queue, for example because it was imported. Refreshing removes the row.
    refresh();
    return { ok: false, error: "That download is no longer in the queue." };
  }

  const downloadId = queued.downloadId;
  // canManualImport needs a non-blank download id, so a match below means downloadId is one.
  const group = app === "radarr" ? [queued] : items.filter((item) => item.downloadId === downloadId);
  if (typeof downloadId !== "string" || !group.some((item) => canManualImport(item))) {
    return { ok: false, error: CANNOT_IMPORT };
  }
  return { ok: true, downloadId };
}

/**
 * Lists the files the app found in the queued row's download, for the Force import dialog (admin only). The server
 * builds the list from its own fresh reads. The browser sends only the row's queue ids. The role check runs first,
 * inside try, and the catch always returns or throws. src/app/server-actions-auth.test.ts enforces this shape.
 */
export async function loadForceImport(input: unknown): Promise<LoadForceImportResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: DENIED_IMPORT };
    throw error;
  }

  const parsed = ForceImportLoadInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid change." };
  const { app, queueIds } = parsed.data;
  const appName = app === "radarr" ? "Radarr" : "Sonarr";

  try {
    const target = await importTargetOf(app, queueIds);
    if (!target.ok) return target;
    const files =
      app === "radarr"
        ? toMovieImportCandidates(await fetchMovieManualImport(target.downloadId))
        : toEpisodeImportCandidates(await fetchEpisodeManualImport(target.downloadId));
    return { ok: true, files };
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Force import: ${error.message}`);
    return { ok: false, error: `${appName} didn't answer. Try again.` };
  }
}

/** What the server will send for a force import, or why it can't. `send` makes the upstream command request. */
type ImportPlan = { ok: true; send: () => Promise<void> } | { ok: false; error: string };

/**
 * Re-reads the queue and the download's scan, and builds the command for the ticked files. This repeats the reads
 * loadForceImport made (including the folder scan) on purpose: the files sent must come from the server's own fresh
 * reads, never from the browser. Nothing is written here, so a read failure before this returns means nothing was
 * imported.
 */
async function planForceImport(
  app: "radarr" | "sonarr",
  queueIds: number[],
  fileIds: number[],
): Promise<ImportPlan> {
  const appName = app === "radarr" ? "Radarr" : "Sonarr";
  try {
    const target = await importTargetOf(app, queueIds);
    if (!target.ok) return target;
    if (app === "radarr") {
      const picked = pickMovieImportFiles(await fetchMovieManualImport(target.downloadId), fileIds, target.downloadId);
      if (!picked.ok) return { ok: false, error: PICK_ERRORS[picked.reason] };
      const files = picked.files;
      return { ok: true, send: () => startMovieManualImport(files) };
    }
    const picked = pickEpisodeImportFiles(await fetchEpisodeManualImport(target.downloadId), fileIds, target.downloadId);
    if (!picked.ok) return { ok: false, error: PICK_ERRORS[picked.reason] };
    const files = picked.files;
    return { ok: true, send: () => startEpisodeManualImport(files) };
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    console.error(`Force import: ${error.message}`);
    return { ok: false, error: `${appName} didn't answer. Nothing was imported.` };
  }
}

/**
 * Imports the ticked files of the queued row's download (admin only). The files are re-scanned and built from the
 * server's own reads, so the browser's file ids are only a choice among them. Radarr or Sonarr queues the import, so a
 * timeout or a broken reply may still mean it started. The message says so. The role check runs first, inside try, and
 * the catch always returns or throws. src/app/server-actions-auth.test.ts enforces this shape.
 */
export async function forceImportQueueItem(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: DENIED_IMPORT };
    throw error;
  }

  const parsed = ForceImportInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid change." };
  const { app, queueIds, fileIds } = parsed.data;
  const appName = app === "radarr" ? "Radarr" : "Sonarr";

  const plan = await planForceImport(app, queueIds, fileIds);
  if (!plan.ok) return { ok: false, error: plan.error };

  try {
    await plan.send();
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    console.error(`Force import: ${error.message}`);
    return { ok: false, error: writeFailureMessage(error, appName, { done: "started", check: "check the queue" }) };
  }

  // The page reads the queue on every request, so refresh() shows the change.
  refresh();
  return { ok: true };
}

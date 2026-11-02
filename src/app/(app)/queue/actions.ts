"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import {
  fetchEpisodeQueue,
  fetchMovieQueue,
  removeEpisodeQueueItems,
  removeMovieQueueItems,
} from "@/server/arr/queue";
import { ArrRequestError } from "@/server/arr/request";
import { firstQueuedId } from "@/server/merge/queue";

export type ActionResult = { ok: true } | { ok: false; error: string };

// strictObject rejects unknown keys (including the old single queueId). The browser sends the row's item ids, and
// they only say which download the admin meant. The server checks them against the app's queue before it acts.
const RemoveInput = z.strictObject({
  app: z.enum(["radarr", "sonarr"]),
  queueIds: z.array(z.number().int().positive()).min(1).max(100),
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
    if (app === "radarr") await removeMovieQueueItems([queuedId], options);
    else await removeEpisodeQueueItems([queuedId], options);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Queue remove: ${error.message}`);
    if (error.status !== undefined && error.status >= 400 && error.status < 500) {
      return { ok: false, error: `${appName} didn't accept it. Try again.` };
    }
    // A timeout or a broken reply can come after the app removed the download, so the user must check first.
    return {
      ok: false,
      error: `${appName} didn't confirm it. It may still have been removed, so check the queue.`,
    };
  }

  // The page reads the queue on every request, so refresh() shows the change.
  refresh();
  return { ok: true };
}

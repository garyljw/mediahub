"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { markEpisodeHistoryFailed, markMovieHistoryFailed } from "@/server/arr/history";
import { ArrRequestError, writeFailureMessage } from "@/server/arr/request";

export type ActionResult = { ok: true } | { ok: false; error: string };

// strictObject rejects unknown keys. Only the app name and the history id cross from the browser.
const MarkFailedInput = z.strictObject({
  app: z.enum(["radarr", "sonarr"]),
  historyId: z.number().int().positive(),
});

/**
 * Marks one grabbed history item as failed in Radarr or Sonarr (admin only). The role check runs first, inside try,
 * and the catch always returns or throws. src/app/server-actions-auth.test.ts enforces this shape for every action.
 */
export async function markHistoryFailed(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to mark downloads as failed." };
    throw error;
  }

  const parsed = MarkFailedInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid change." };
  const { app, historyId } = parsed.data;
  const appName = app === "radarr" ? "Radarr" : "Sonarr";

  try {
    if (app === "radarr") await markMovieHistoryFailed(historyId);
    else await markEpisodeHistoryFailed(historyId);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`History mark failed: ${error.message}`);
    // A timeout or a broken reply can come after Radarr or Sonarr marked the item, so the user must check first.
    return { ok: false, error: writeFailureMessage(error, appName, { done: "marked failed", check: "reload the page to check" }) };
  }

  // The page reads the history on every request, so refresh() shows the new event.
  refresh();
  return { ok: true };
}

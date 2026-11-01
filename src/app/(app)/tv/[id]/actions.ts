"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import {
  SeasonNotFoundError,
  searchEpisode,
  searchSeason,
  setEpisodeMonitored,
  setSeasonMonitored,
} from "@/server/arr/episodes";
import { ArrRequestError } from "@/server/arr/request";

export type ActionResult = { ok: true } | { ok: false; error: string };

// strictObject rejects unknown keys. Only ids, a season number and a boolean cross from the browser.
const EpisodeMonitorInput = z.strictObject({
  episodeId: z.number().int().positive(),
  monitored: z.boolean(),
});

const SeasonMonitorInput = z.strictObject({
  seriesId: z.number().int().positive(),
  seasonNumber: z.number().int().min(0),
  monitored: z.boolean(),
});

const SeasonSearchInput = z.strictObject({
  seriesId: z.number().int().positive(),
  seasonNumber: z.number().int().min(0),
});

const EpisodeSearchInput = z.strictObject({
  episodeId: z.number().int().positive(),
});

/**
 * The message for a failed monitoring change. Before the write is sent, nothing changed, so a plain retry is fine.
 * After it is sent, only a 4xx answer means Sonarr refused it: a timeout, a dropped connection, an odd reply or a
 * 5xx (from Sonarr or a proxy) can all come after Sonarr saved the change, so the user must check first.
 */
function monitorFailure(error: ArrRequestError, sent: boolean): string {
  if (!sent) return "Couldn't load the series from Sonarr, so nothing changed. Try again.";
  if (error.status !== undefined && error.status >= 400 && error.status < 500) {
    return "Sonarr didn't accept the change. Try again.";
  }
  if (error.kind === "timeout") {
    return "Sonarr took too long to answer. The change may still have been saved, so reload the page to check.";
  }
  return "Sonarr didn't confirm the change. It may still have been saved, so reload the page to check.";
}

/**
 * Sets one episode's monitored flag (admin only). The role check runs first, inside try, and the catch always
 * returns or throws. src/app/server-actions-auth.test.ts enforces this shape for every action.
 */
export async function setEpisodeMonitoring(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to change monitoring." };
    throw error;
  }

  const parsed = EpisodeMonitorInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid change." };

  try {
    await setEpisodeMonitored(parsed.data.episodeId, parsed.data.monitored);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Episode monitor: ${error.message}`);
    // The write is the only request, so it counts as sent.
    return { ok: false, error: monitorFailure(error, true) };
  }

  // The page reads Sonarr on every request and nothing is cached, so refresh() shows the new flag.
  refresh();
  return { ok: true };
}

/**
 * Sets one season's monitored flag (admin only). Same shape as setEpisodeMonitoring. A season or series that
 * Sonarr no longer has gets its own message.
 */
export async function setSeasonMonitoring(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to change monitoring." };
    throw error;
  }

  const parsed = SeasonMonitorInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid change." };
  const { seriesId, seasonNumber, monitored } = parsed.data;

  // Set just before the PUT, so a failure on the GET before it is known to have changed nothing.
  let sent = false;
  try {
    await setSeasonMonitored(seriesId, seasonNumber, monitored, () => {
      sent = true;
    });
  } catch (error) {
    if (error instanceof SeasonNotFoundError) return { ok: false, error: "That season no longer exists." };
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Season monitor: ${error.message}`);
    return { ok: false, error: monitorFailure(error, sent) };
  }

  refresh();
  return { ok: true };
}

/**
 * Asks Sonarr to search for one season's monitored episodes (admin and requester). The role check runs first,
 * inside try, and the catch always returns or throws. Sonarr only queues the search, and nothing on the page
 * changes, so there is no refresh().
 */
export async function searchSeasonNow(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to search for episodes." };
    throw error;
  }

  const parsed = SeasonSearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };
  const { seriesId, seasonNumber } = parsed.data;

  try {
    await searchSeason(seriesId, seasonNumber);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Season search: ${error.message}`);
    // After a timeout Sonarr may have queued the search anyway, so don't tell the user to just retry.
    if (error.kind === "timeout") {
      return { ok: false, error: "Sonarr took too long to answer. The search may still have started, so check Sonarr before trying again." };
    }
    return { ok: false, error: "Sonarr didn't start the search. Try again." };
  }

  return { ok: true };
}

/**
 * Asks Sonarr to search for releases for one episode (admin and requester). Same shape as searchSeasonNow.
 */
export async function searchEpisodeNow(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to search for episodes." };
    throw error;
  }

  const parsed = EpisodeSearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };

  try {
    await searchEpisode(parsed.data.episodeId);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Episode search: ${error.message}`);
    // After a timeout Sonarr may have queued the search anyway, so don't tell the user to just retry.
    if (error.kind === "timeout") {
      return { ok: false, error: "Sonarr took too long to answer. The search may still have started, so check Sonarr before trying again." };
    }
    return { ok: false, error: "Sonarr didn't start the search. Try again." };
  }

  return { ok: true };
}

"use server";

import { RedirectType, redirect } from "next/navigation";
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
import { deleteSeries } from "@/server/arr/series";
import { ArrRequestError } from "@/server/arr/request";
import { ReleaseGrabError, grabWasRefused } from "@/server/arr/releases";
import { grabSeriesRelease as sendSeriesRelease, searchSeriesReleases } from "@/server/arr/series-releases";
import type { GrabResult, ReleaseSearchResult } from "@/components/library/release";

export type { GrabResult, ReleaseSearchResult };

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

// Sonarr searches for one season or one episode, never for a series alone. This union is strict, so a series id by
// itself, a season with an episode id, and any extra key are all refused before Sonarr is asked. An episode search
// takes no series id: Sonarr finds the series from the episode.
const SeriesReleaseSearchInput = z.union([
  z.strictObject({
    seriesId: z.number().int().positive(),
    seasonNumber: z.number().int().min(0),
  }),
  z.strictObject({
    episodeId: z.number().int().positive(),
  }),
]);

/**
 * Asks Sonarr for interactive release search results for one season or one episode (admin only). Same shape as the
 * other actions: the role check runs first inside try, and the catch always returns or throws. Nothing on the page
 * changes, so there is no refresh(). The rows carry only what the dialog shows, plus the server's token.
 */
export async function findSeriesReleases(input: unknown): Promise<ReleaseSearchResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to pick releases." };
    throw error;
  }

  const parsed = SeriesReleaseSearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };

  try {
    const { rows, totals } = await searchSeriesReleases(parsed.data);
    return { ok: true, releases: rows, totals };
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Release search: ${error.message}`);
    if (error.kind === "timeout") {
      return { ok: false, error: "Sonarr took too long searching the indexers. Try again in a moment." };
    }
    if (error.kind === "http" && error.status === 404) {
      return { ok: false, error: "That season or episode is no longer in Sonarr. Close this and reload the page." };
    }
    return { ok: false, error: "Sonarr couldn't search the indexers. Try again." };
  }
}

// strictObject rejects unknown keys. The browser sends only the token from a search result.
const SeriesReleaseGrabInput = z.strictObject({
  token: z.uuid(),
});

/**
 * Sends a release from an earlier search to Sonarr's download client (admin only). Same shape as the other actions:
 * the role check runs first inside try, and the catch always returns or throws. The release is taken from the
 * server's cache, so the browser can only grab what Sonarr returned. Nothing on the page changes, so there is no
 * refresh().
 */
export async function grabSeriesRelease(input: unknown): Promise<GrabResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to pick releases." };
    throw error;
  }

  const parsed = SeriesReleaseGrabInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid grab." };

  try {
    const grabbed = await sendSeriesRelease(parsed.data.token);
    return { ok: true, title: grabbed.title };
  } catch (error) {
    // Sonarr answers 404 both when it no longer has the release and when it can't match it to episodes.
    if (error instanceof ReleaseGrabError) {
      return {
        ok: false,
        error: "Sonarr can no longer use that result: it may have expired, or Sonarr couldn't match it to episodes. Search again or pick another one.",
      };
    }
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Release grab: ${error.message}`);
    // A timeout or a dropped connection can mean Sonarr already sent the release, so don't invite a blind retry.
    if (error.kind === "timeout") {
      return {
        ok: false,
        error: "Sonarr took too long to answer. The release may still have been grabbed, so check the queue before trying again.",
      };
    }
    // Only a refusal means nothing was grabbed. A 5xx can come after the release reached the download client.
    if (grabWasRefused(error)) {
      if (error.status === 409) return { ok: false, error: "The indexer didn't hand over that release. Try again, or pick another one." };
      return { ok: false, error: "Sonarr didn't grab the release. Try again." };
    }
    return {
      ok: false,
      error: "Sonarr didn't confirm the grab. It may still have been sent, so check the queue before trying again.",
    };
  }
}

// Only the one series id crosses from the browser. strictObject rejects any other key, and the two booleans are
// required, so a missing choice can never be read as "no".
const SeriesItemDeleteInput = z.strictObject({
  seriesId: z.number().int().positive(),
  deleteFiles: z.boolean(),
  addImportListExclusion: z.boolean(),
});

export type DeleteResult = { ok: false; error: string };

/**
 * Deletes this series from Sonarr (admin only), for the series page. Same role check as the table's delete, and
 * the catch always returns or throws. On success it sends the browser back to the TV list. The redirect sits
 * outside the try, because redirect throws.
 */
export async function deleteSeriesItem(input: unknown): Promise<DeleteResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to delete series." };
    throw error;
  }

  const parsed = SeriesItemDeleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid delete." };
  const { seriesId, deleteFiles, addImportListExclusion } = parsed.data;

  try {
    await deleteSeries({ seriesIds: [seriesId], deleteFiles, addImportListExclusion });
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Series delete: ${error.message}`);
    // Sonarr may have deleted it anyway (certainly possible after a timeout), so re-read the page rather than keep
    // showing an item that might be gone. If it is gone, the page shows not-found.
    refresh();
    if (error.kind === "timeout") {
      return { ok: false, error: "Sonarr is taking a long time and may still be deleting. The page has been refreshed; check it before trying again." };
    }
    return { ok: false, error: "Sonarr didn't confirm the delete, so the series may already be gone. The page has been refreshed; check it before trying again." };
  }

  // replace, not push, so Back doesn't return to the deleted item's page.
  redirect("/tv", RedirectType.replace);
}

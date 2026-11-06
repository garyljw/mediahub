"use server";

import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { refreshMovies, searchMovieReleases } from "@/server/arr/movies";
import { lookupMovies, type LookupResult } from "@/server/arr/movie-add";
import { ArrRequestError } from "@/server/arr/request";
import { addMovieAs, type AddResult } from "@/server/add/movie-add";
import { ReleaseGrabError, grabRelease, grabWasRefused, searchReleases } from "@/server/arr/releases";
import type { GrabResult, ReleaseSearchResult } from "@/components/library/release";
import { MAX_TERM_LENGTH } from "@/components/library/add";
import { MAX_SEARCH_MOVIES } from "@/components/movies/movie-search";
import { MAX_REFRESH_MOVIES } from "@/components/movies/movie-refresh";

export type SearchResult = { ok: true; results: LookupResult[] } | { ok: false; error: string };

// The term is trimmed, and must be 1 to MAX_TERM_LENGTH characters after trimming. strictObject rejects any other key.
const MovieSearchInput = z.strictObject({
  term: z.string().trim().min(1).max(MAX_TERM_LENGTH),
});

/**
 * Searches TMDB through Radarr (admin and requester). The role check runs first, inside try, and the
 * catch always returns or throws, as in the other actions. Results carry only LookupResult fields.
 */
export async function searchMovies(input: unknown): Promise<SearchResult> {
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to add movies." };
    throw error;
  }

  const parsed = MovieSearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a movie title to search for." };

  try {
    return { ok: true, results: await lookupMovies(parsed.data.term) };
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    console.error(`Movie search: ${error.message}`);
    return { ok: false, error: "Radarr couldn't complete the search. Try again." };
  }
}

export type { AddResult };

/**
 * Adds one TMDB movie to the Radarr library. A requester sends only the TMDB id, and the saved Add defaults
 * decide the profile and folder (or the first item when those are missing), with the movie monitored and search on.
 * An admin also sends the profile, folder, monitored and search choices. Same shape as the other actions: the role
 * check runs first inside try, and the catch always returns or throws. The add itself is in src/server/add/movie-add.ts,
 * shared with the Focus page.
 */
export async function addLibraryMovie(input: unknown): Promise<AddResult> {
  try {
    const { user } = await requireRole("admin", "requester");
    return await addMovieAs(user.role === "admin", input);
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to add movies." };
    throw error;
  }
}

export type SearchNowResult = { ok: true; searched: number } | { ok: false; error: string };

// strictObject rejects unknown keys. Only ids cross from the browser.
const MovieSearchNowInput = z.strictObject({
  movieIds: z.array(z.number().int().positive()).min(1).max(MAX_SEARCH_MOVIES),
});

/**
 * Starts a Radarr release search for existing library movies (admin and requester). Same shape as the
 * other actions: the role check runs first inside try, and the catch always returns or throws. Radarr
 * queues the search and answers at once, and nothing on the page changes, so there is no refresh().
 */
export async function searchLibraryMovies(input: unknown): Promise<SearchNowResult> {
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to search for movies." };
    throw error;
  }

  const parsed = MovieSearchNowInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };

  // A Set drops duplicate ids, so Radarr searches each movie once.
  const movieIds = [...new Set(parsed.data.movieIds)];
  try {
    await searchMovieReleases(movieIds);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movie search now: ${error.message}`);
    // After a timeout Radarr may have queued the search anyway, so don't tell the user to just retry.
    if (error.kind === "timeout") {
      return { ok: false, error: "Radarr took too long to answer. The search may still have started, so check Radarr before trying again." };
    }
    return { ok: false, error: "Radarr didn't start the search. Try again." };
  }
  return { ok: true, searched: movieIds.length };
}

export type RefreshResult = { ok: true; refreshed: number } | { ok: false; error: string };

// strictObject rejects unknown keys. Only ids cross from the browser.
const MovieRefreshInput = z.strictObject({
  movieIds: z.array(z.number().int().positive()).min(1).max(MAX_REFRESH_MOVIES),
});

/**
 * Asks Radarr to refresh metadata and rescan disk for library movies (admin only). Same shape as the other
 * actions: the role check runs first inside try, and the catch always returns or throws. Radarr queues the
 * refresh and answers at once, so the data on the page is the same afterwards and there is no refresh().
 */
export async function refreshLibraryMovies(input: unknown): Promise<RefreshResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to refresh movies." };
    throw error;
  }

  const parsed = MovieRefreshInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid refresh." };

  // A Set drops duplicate ids, so Radarr refreshes each movie once.
  const movieIds = [...new Set(parsed.data.movieIds)];
  try {
    await refreshMovies(movieIds);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movie refresh: ${error.message}`);
    // After a timeout Radarr may have queued the refresh anyway, so don't tell the user to just retry.
    if (error.kind === "timeout") {
      return { ok: false, error: "Radarr took too long to answer. The refresh may still have started, so check Radarr before trying again." };
    }
    return { ok: false, error: "Radarr didn't start the refresh. Try again." };
  }
  return { ok: true, refreshed: movieIds.length };
}

export type { GrabResult, ReleaseSearchResult };

// strictObject rejects unknown keys. Only the movie id crosses from the browser.
const ReleaseSearchInput = z.strictObject({
  movieId: z.number().int().positive(),
});

/**
 * Asks Radarr for interactive release search results for one library movie (admin only). Same shape as the
 * other actions: the role check runs first inside try, and the catch always returns or throws. Nothing on the
 * page changes, so there is no refresh(). The rows carry only what the dialog shows, plus the server's token.
 */
export async function findMovieReleases(input: unknown): Promise<ReleaseSearchResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to pick releases." };
    throw error;
  }

  const parsed = ReleaseSearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };

  try {
    const { rows, totals } = await searchReleases(parsed.data.movieId);
    return { ok: true, releases: rows, totals };
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Release search: ${error.message}`);
    if (error.kind === "timeout") {
      return { ok: false, error: "Radarr took too long searching the indexers. Try again in a moment." };
    }
    if (error.kind === "http" && error.status === 404) {
      return { ok: false, error: "That movie is no longer in Radarr. Close this and reload the page." };
    }
    return { ok: false, error: "Radarr couldn't search the indexers. Try again." };
  }
}

// strictObject rejects unknown keys. The browser sends only the token from a search result.
const ReleaseGrabInput = z.strictObject({
  token: z.uuid(),
});

/**
 * Sends a release from an earlier search to Radarr's download client (admin only). Same shape as the other
 * actions: the role check runs first inside try, and the catch always returns or throws. The release is taken
 * from the server's cache, so the browser can only grab what Radarr returned. Nothing on the page changes, so
 * there is no refresh().
 */
export async function grabMovieRelease(input: unknown): Promise<GrabResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to pick releases." };
    throw error;
  }

  const parsed = ReleaseGrabInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid grab." };

  try {
    const grabbed = await grabRelease(parsed.data.token);
    return { ok: true, title: grabbed.title };
  } catch (error) {
    if (error instanceof ReleaseGrabError) return { ok: false, error: "That result has expired. Search again." };
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Release grab: ${error.message}`);
    // A timeout or a dropped connection can mean Radarr already sent the release, so don't invite a blind retry.
    if (error.kind === "timeout") {
      return {
        ok: false,
        error: "Radarr took too long to answer. The release may still have been grabbed, so check the queue before trying again.",
      };
    }
    // Only a refusal means nothing was grabbed. A 5xx can come after the release reached the download client.
    if (grabWasRefused(error)) {
      if (error.status === 409) return { ok: false, error: "The indexer didn't hand over that release. Try again, or pick another one." };
      return { ok: false, error: "Radarr didn't grab the release. Try again." };
    }
    return {
      ok: false,
      error: "Radarr didn't confirm the grab. It may still have been sent, so check the queue before trying again.",
    };
  }
}

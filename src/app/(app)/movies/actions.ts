"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import {
  deleteMovies,
  editMovies,
  listQualityProfiles,
  refreshMovies,
  searchMovieReleases,
  type MovieEdit,
} from "@/server/arr/movies";
import {
  MovieAddError,
  addMovie,
  listRootFolders,
  lookupMovies,
  type LookupResult,
} from "@/server/arr/movie-add";
import { ArrRequestError } from "@/server/arr/request";
import { MAX_TERM_LENGTH } from "@/components/movies/movie-add";
import { MAX_EDIT_MOVIES } from "@/components/movies/movie-edit";
import { MAX_SEARCH_MOVIES } from "@/components/movies/movie-search";
import { MAX_REFRESH_MOVIES } from "@/components/movies/movie-refresh";

export type EditResult = { ok: true } | { ok: false; error: string };

// strictObject rejects unknown keys. The refine requires at least one change, so an empty edit is refused.
const MovieEditInput = z
  .strictObject({
    movieIds: z.array(z.number().int().positive()).min(1).max(MAX_EDIT_MOVIES),
    qualityProfileId: z.number().int().positive().optional(),
    monitored: z.boolean().optional(),
  })
  .refine((input) => input.qualityProfileId !== undefined || input.monitored !== undefined);

/**
 * Bulk edit of Radarr movies (admin only). The role check is the first thing that runs. It sits
 * inside try so a denial returns { ok: false } instead of throwing. The catch always returns or
 * throws, so nothing after it runs without a passed check. src/app/server-actions-auth.test.ts
 * enforces this shape for every action.
 */
export async function updateMovies(input: unknown): Promise<EditResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to edit movies." };
    throw error;
  }

  const parsed = MovieEditInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid edit." };

  const { qualityProfileId, monitored } = parsed.data;
  // A Set drops duplicate ids, so Radarr gets each movie once.
  const edit: MovieEdit = { movieIds: [...new Set(parsed.data.movieIds)] };
  if (qualityProfileId !== undefined) edit.qualityProfileId = qualityProfileId;
  if (monitored !== undefined) edit.monitored = monitored;

  try {
    if (qualityProfileId !== undefined) {
      const profiles = await listQualityProfiles();
      if (!profiles.some((profile) => profile.id === qualityProfileId)) {
        return { ok: false, error: "That quality profile no longer exists." };
      }
    }
    await editMovies(edit);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movie edit: ${error.message}`);
    return { ok: false, error: "Radarr didn't accept the change. Try again." };
  }

  // The Movies page reads Radarr on every request and nothing is cached, so there is no cache entry
  // to invalidate. refresh() re-renders the current route, so the table shows the new values.
  refresh();
  return { ok: true };
}

export type DeleteResult = { ok: true; deleted: number } | { ok: false; error: string };

// strictObject rejects unknown keys (e.g. a stray moveFiles). deleteFiles and addImportExclusion are
// required, so a missing choice can never be read as "no". confirmCount must equal the de-duplicated id
// count: a sanity check that catches a UI bug sending more or fewer movies than the dialog showed. It
// compares counts only, not which movies; that's fine because only an admin can get this far.
const MovieDeleteInput = z.strictObject({
  movieIds: z.array(z.number().int().positive()).min(1).max(MAX_EDIT_MOVIES),
  deleteFiles: z.boolean(),
  addImportExclusion: z.boolean(),
  confirmCount: z.number().int().positive(),
});

/**
 * Bulk delete of Radarr movies (admin only). Same shape as updateMovies: the role check runs first,
 * inside try, and the catch always returns or throws. src/app/server-actions-auth.test.ts enforces this.
 */
export async function removeMovies(input: unknown): Promise<DeleteResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to delete movies." };
    throw error;
  }

  const parsed = MovieDeleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid delete." };

  const { deleteFiles, addImportExclusion, confirmCount } = parsed.data;
  // A Set drops duplicate ids, so Radarr gets each movie once. The count check runs on the unique ids.
  const movieIds = [...new Set(parsed.data.movieIds)];
  if (confirmCount !== movieIds.length) return { ok: false, error: "Invalid delete." };

  try {
    await deleteMovies({ movieIds, deleteFiles, addImportExclusion });
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movie delete: ${error.message}`);
    // Radarr may have deleted some or all of them anyway (certainly possible after a timeout), so
    // re-read the table rather than keep showing rows that might be gone.
    refresh();
    if (error.kind === "timeout") {
      return { ok: false, error: "Radarr is taking a long time and may still be deleting. The table has been refreshed; check it before trying again." };
    }
    // Any failure after the request was sent (a proxy 504, a dropped connection, an odd reply) is
    // ambiguous too, so don't claim nothing was deleted.
    return { ok: false, error: "Radarr didn't confirm the delete, so some movies may already be gone. The table has been refreshed; check it before trying again." };
  }

  // Nothing is cached, so refresh() is enough for the table to drop the deleted rows.
  refresh();
  return { ok: true, deleted: movieIds.length };
}

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

export type AddResult = { ok: true; title: string; year: number | null } | { ok: false; error: string };

// Only ids and booleans cross from the browser. The root folder is an id too: the server resolves it
// to a path itself, so no path or title is ever accepted from the client.
const MovieAddInput = z.strictObject({
  tmdbId: z.number().int().positive(),
  qualityProfileId: z.number().int().positive(),
  rootFolderId: z.number().int().positive(),
  monitored: z.boolean(),
  searchForMovie: z.boolean(),
});

/**
 * Adds one TMDB movie to the Radarr library (admin and requester). Same shape as the other actions:
 * the role check runs first inside try, and the catch always returns or throws.
 */
export async function addLibraryMovie(input: unknown): Promise<AddResult> {
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to add movies." };
    throw error;
  }

  const parsed = MovieAddInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid add." };
  const { tmdbId, qualityProfileId, rootFolderId, monitored, searchForMovie } = parsed.data;

  // Set just before the add is sent. Only a timeout after that point can mean Radarr added the movie.
  let addSent = false;
  try {
    const [profiles, folders] = await Promise.all([listQualityProfiles(), listRootFolders()]);
    if (!profiles.some((profile) => profile.id === qualityProfileId)) {
      return { ok: false, error: "That quality profile no longer exists." };
    }
    const folder = folders.find((option) => option.id === rootFolderId);
    if (!folder) return { ok: false, error: "That root folder no longer exists." };

    addSent = true;
    const added = await addMovie({ tmdbId, qualityProfileId, rootFolderPath: folder.path, monitored, searchForMovie });
    // The Movies page reads Radarr on every request, so refresh() is enough for the new row to appear.
    refresh();
    return { ok: true, title: added.title, year: added.year };
  } catch (error) {
    if (error instanceof MovieAddError) {
      if (error.reason === "exists") return { ok: false, error: "That movie is already in your library." };
      return { ok: false, error: "Radarr couldn't find that movie." };
    }
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movie add: ${error.message}`);
    // A timeout means Radarr may have finished the add after we gave up, so the user must check the library.
    if (addSent && error.kind === "timeout") {
      return {
        ok: false,
        error: "Radarr took too long to answer. The movie may still have been added, so reload the page to check.",
      };
    }
    return { ok: false, error: "Radarr didn't accept the movie. Try again." };
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

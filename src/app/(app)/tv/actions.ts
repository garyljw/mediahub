"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import {
  deleteSeries,
  editSeries,
  listSeriesQualityProfiles,
  refreshSeries,
  searchSeriesReleases,
  type SeriesEdit,
} from "@/server/arr/series";
import {
  SeriesAddError,
  addSeries,
  listSeriesRootFolders,
  lookupSeries,
  type SeriesLookupResult,
} from "@/server/arr/series-add";
import { ArrRequestError } from "@/server/arr/request";
import { MAX_EDIT_SERIES } from "@/components/tv/series-edit";
import { SERIES_MONITOR_OPTIONS, SERIES_TYPE_OPTIONS } from "@/components/tv/series-add";
import { MAX_TERM_LENGTH } from "@/components/library/add";
import { MAX_SEARCH_SERIES } from "@/components/tv/series-search";
import { MAX_REFRESH_SERIES } from "@/components/tv/series-refresh";

export type EditResult = { ok: true } | { ok: false; error: string };

// strictObject rejects unknown keys. The refine requires at least one change, so an empty edit is refused.
const SeriesEditInput = z
  .strictObject({
    seriesIds: z.array(z.number().int().positive()).min(1).max(MAX_EDIT_SERIES),
    qualityProfileId: z.number().int().positive().optional(),
    monitored: z.boolean().optional(),
  })
  .refine((input) => input.qualityProfileId !== undefined || input.monitored !== undefined);

/**
 * Bulk edit of Sonarr series (admin only). The role check is the first thing that runs. It sits
 * inside try so a denial returns { ok: false } instead of throwing. The catch always returns or
 * throws, so nothing after it runs without a passed check. src/app/server-actions-auth.test.ts
 * enforces this shape for every action.
 */
export async function updateSeries(input: unknown): Promise<EditResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to edit series." };
    throw error;
  }

  const parsed = SeriesEditInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid edit." };

  const { qualityProfileId, monitored } = parsed.data;
  // A Set drops duplicate ids, so Sonarr gets each series once.
  const edit: SeriesEdit = { seriesIds: [...new Set(parsed.data.seriesIds)] };
  if (qualityProfileId !== undefined) edit.qualityProfileId = qualityProfileId;
  if (monitored !== undefined) edit.monitored = monitored;

  try {
    if (qualityProfileId !== undefined) {
      const profiles = await listSeriesQualityProfiles();
      if (!profiles.some((profile) => profile.id === qualityProfileId)) {
        return { ok: false, error: "That quality profile no longer exists." };
      }
    }
    await editSeries(edit);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Series edit: ${error.message}`);
    return { ok: false, error: "Sonarr didn't accept the change. Try again." };
  }

  // The TV page reads Sonarr on every request and nothing is cached, so there is no cache entry
  // to invalidate. refresh() re-renders the current route, so the table shows the new values.
  refresh();
  return { ok: true };
}

export type DeleteResult = { ok: true; deleted: number } | { ok: false; error: string };

// strictObject rejects unknown keys (e.g. a stray moveFiles). deleteFiles and addImportListExclusion are
// required, so a missing choice can never be read as "no". confirmCount must equal the de-duplicated id
// count: a sanity check that catches a UI bug sending more or fewer series than the dialog showed. It
// compares counts only, not which series; that's fine because only an admin can get this far.
const SeriesDeleteInput = z.strictObject({
  seriesIds: z.array(z.number().int().positive()).min(1).max(MAX_EDIT_SERIES),
  deleteFiles: z.boolean(),
  addImportListExclusion: z.boolean(),
  confirmCount: z.number().int().positive(),
});

/**
 * Bulk delete of Sonarr series (admin only). Same shape as updateSeries: the role check runs first,
 * inside try, and the catch always returns or throws. src/app/server-actions-auth.test.ts enforces this.
 */
export async function removeSeries(input: unknown): Promise<DeleteResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to delete series." };
    throw error;
  }

  const parsed = SeriesDeleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid delete." };

  const { deleteFiles, addImportListExclusion, confirmCount } = parsed.data;
  // A Set drops duplicate ids, so Sonarr gets each series once. The count check runs on the unique ids.
  const seriesIds = [...new Set(parsed.data.seriesIds)];
  if (confirmCount !== seriesIds.length) return { ok: false, error: "Invalid delete." };

  try {
    await deleteSeries({ seriesIds, deleteFiles, addImportListExclusion });
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Series delete: ${error.message}`);
    // Sonarr may have deleted some or all of them anyway (certainly possible after a timeout), so
    // re-read the table rather than keep showing rows that might be gone.
    refresh();
    if (error.kind === "timeout") {
      return { ok: false, error: "Sonarr is taking a long time and may still be deleting. The table has been refreshed; check it before trying again." };
    }
    // Any failure after the request was sent (a proxy 504, a dropped connection, an odd reply) is
    // ambiguous too, so don't claim nothing was deleted.
    return { ok: false, error: "Sonarr didn't confirm the delete, so some series may already be gone. The table has been refreshed; check it before trying again." };
  }

  // Nothing is cached, so refresh() is enough for the table to drop the deleted rows.
  refresh();
  return { ok: true, deleted: seriesIds.length };
}

export type SearchResult = { ok: true; results: SeriesLookupResult[] } | { ok: false; error: string };

// The term is trimmed, and must be 1 to MAX_TERM_LENGTH characters after trimming. strictObject rejects any other key.
const SeriesSearchInput = z.strictObject({
  term: z.string().trim().min(1).max(MAX_TERM_LENGTH),
});

/**
 * Searches TVDB through Sonarr (admin and requester). The role check runs first, inside try, and the
 * catch always returns or throws, as in the other actions. Results carry only SeriesLookupResult fields.
 */
export async function searchSeries(input: unknown): Promise<SearchResult> {
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to add series." };
    throw error;
  }

  const parsed = SeriesSearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a series title to search for." };

  try {
    return { ok: true, results: await lookupSeries(parsed.data.term) };
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    console.error(`Series search: ${error.message}`);
    return { ok: false, error: "Sonarr couldn't complete the search. Try again." };
  }
}

export type AddResult = { ok: true; title: string; year: number | null } | { ok: false; error: string };

// Only ids, enum values and booleans cross from the browser. The root folder is an id too: the server resolves
// it to a path itself, so no path, title or URL is ever accepted from the client.
const SeriesAddInput = z.strictObject({
  tvdbId: z.number().int().positive(),
  qualityProfileId: z.number().int().positive(),
  rootFolderId: z.number().int().positive(),
  monitor: z.enum(SERIES_MONITOR_OPTIONS),
  seriesType: z.enum(SERIES_TYPE_OPTIONS),
  searchForMissingEpisodes: z.boolean(),
});

/**
 * Adds one TVDB series to the Sonarr library (admin and requester). Same shape as the other actions:
 * the role check runs first inside try, and the catch always returns or throws.
 */
export async function addLibrarySeries(input: unknown): Promise<AddResult> {
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to add series." };
    throw error;
  }

  const parsed = SeriesAddInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid add." };
  const { tvdbId, qualityProfileId, rootFolderId, monitor, seriesType, searchForMissingEpisodes } = parsed.data;

  // Set by addSeries's onSend, just before the add request goes out. Only a timeout after that point can mean
  // Sonarr added the series; a timeout in the lookup or the library check before it cannot.
  let addSent = false;
  try {
    const [profiles, folders] = await Promise.all([listSeriesQualityProfiles(), listSeriesRootFolders()]);
    if (!profiles.some((profile) => profile.id === qualityProfileId)) {
      return { ok: false, error: "That quality profile no longer exists." };
    }
    const folder = folders.find((option) => option.id === rootFolderId);
    if (!folder) return { ok: false, error: "That root folder no longer exists." };

    const added = await addSeries(
      {
        tvdbId,
        qualityProfileId,
        rootFolderPath: folder.path,
        monitor,
        seriesType,
        searchForMissingEpisodes,
      },
      () => {
        addSent = true;
      },
    );
    // The TV page reads Sonarr on every request, so refresh() is enough for the new row to appear.
    refresh();
    return { ok: true, title: added.title, year: added.year };
  } catch (error) {
    if (error instanceof SeriesAddError) {
      if (error.reason === "exists") return { ok: false, error: "That series is already in your library." };
      return { ok: false, error: "Sonarr couldn't find that series." };
    }
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Series add: ${error.message}`);
    // A timeout means Sonarr may have finished the add after we gave up, so the user must check the library.
    if (addSent && error.kind === "timeout") {
      return {
        ok: false,
        error: "Sonarr took too long to answer. The series may still have been added, so reload the page to check.",
      };
    }
    return { ok: false, error: "Sonarr didn't accept the series. Try again." };
  }
}

/** startedIds is set when a bulk search stops partway: the series Sonarr did accept, so the table can deselect them. */
export type SearchNowResult = { ok: true; searched: number } | { ok: false; error: string; startedIds?: number[] };

// strictObject rejects unknown keys. Only ids cross from the browser.
const SeriesSearchNowInput = z.strictObject({
  seriesIds: z.array(z.number().int().positive()).min(1).max(MAX_SEARCH_SERIES),
});

/**
 * Asks Sonarr to search for releases for library series (admin and requester). Sonarr's SeriesSearch command
 * takes one series, so each series is a separate call, made one after another. The role check runs first,
 * inside try, and the catch always returns or throws. Nothing on the page changes, so there is no refresh().
 */
export async function searchLibrarySeries(input: unknown): Promise<SearchNowResult> {
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to search for series." };
    throw error;
  }

  const parsed = SeriesSearchNowInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };

  // A Set drops duplicate ids, so Sonarr searches each series once.
  const seriesIds = [...new Set(parsed.data.seriesIds)];
  // The searches Sonarr accepted, so a failure partway through can say how far it got.
  const startedIds: number[] = [];
  try {
    for (const seriesId of seriesIds) {
      await searchSeriesReleases(seriesId);
      startedIds.push(seriesId);
    }
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Series search now: ${error.message}`);
    // Earlier searches were accepted, so stop here rather than send more. The table deselects the started ones.
    if (startedIds.length > 0) {
      const progress = `Sonarr started searches for ${startedIds.length} of ${seriesIds.length} series`;
      // After a timeout Sonarr may have queued that search too, so don't call it failed.
      const next =
        error.kind === "timeout" ? "then took too long on the next one, which may also have started" : "then the next one failed";
      return {
        ok: false,
        error: `${progress}, ${next}. Those are now deselected; check Sonarr before searching the rest.`,
        startedIds,
      };
    }
    // After a timeout Sonarr may have queued the search anyway, so don't tell the user to just retry.
    if (error.kind === "timeout") {
      return {
        ok: false,
        error: "Sonarr took too long to answer. The search may still have started, so check Sonarr before trying again.",
      };
    }
    return { ok: false, error: "Sonarr didn't start the search. Try again." };
  }
  return { ok: true, searched: seriesIds.length };
}

export type RefreshResult = { ok: true; refreshed: number } | { ok: false; error: string };

// strictObject rejects unknown keys. Only ids cross from the browser.
const SeriesRefreshInput = z.strictObject({
  seriesIds: z.array(z.number().int().positive()).min(1).max(MAX_REFRESH_SERIES),
});

/**
 * Asks Sonarr to refresh metadata and rescan disk for library series (admin only). Same shape as the other
 * actions: the role check runs first inside try, and the catch always returns or throws. Sonarr queues the
 * refresh and answers at once, so the data on the page is the same afterwards and there is no refresh().
 */
export async function refreshLibrarySeries(input: unknown): Promise<RefreshResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to refresh series." };
    throw error;
  }

  const parsed = SeriesRefreshInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid refresh." };

  // A Set drops duplicate ids, so Sonarr refreshes each series once.
  const seriesIds = [...new Set(parsed.data.seriesIds)];
  try {
    await refreshSeries(seriesIds);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Series refresh: ${error.message}`);
    // After a timeout Sonarr may have queued the refresh anyway, so don't tell the user to just retry.
    if (error.kind === "timeout") {
      return {
        ok: false,
        error: "Sonarr took too long to answer. The refresh may still have started, so check Sonarr before trying again.",
      };
    }
    return { ok: false, error: "Sonarr didn't start the refresh. Try again." };
  }
  return { ok: true, refreshed: seriesIds.length };
}

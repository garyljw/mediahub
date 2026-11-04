"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import {
  listSeriesQualityProfiles,
  refreshSeries,
  searchSeriesReleases,
} from "@/server/arr/series";
import {
  SeriesAddError,
  addSeries,
  listSeriesRootFolders,
  lookupSeries,
  type SeriesLookupResult,
} from "@/server/arr/series-add";
import { ArrRequestError } from "@/server/arr/request";
import { getSeriesAddDefaults } from "@/server/settings/add-defaults";
import { resolveAddTarget } from "@/server/settings/add-target";
import { SERIES_MONITOR_OPTIONS, SERIES_TYPE_OPTIONS, type SeriesMonitor, type SeriesTypeOption } from "@/components/tv/series-add";
import { MAX_TERM_LENGTH } from "@/components/library/add";
import { MAX_SEARCH_SERIES } from "@/components/tv/series-search";
import { MAX_REFRESH_SERIES } from "@/components/tv/series-refresh";

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

export type AddResult = { ok: true; id: number | null; title: string; year: number | null } | { ok: false; error: string };

// Requesters send only the TVDB id. strictObject rejects any other key, so a requester cannot pick a profile,
// a folder, a monitor or a series type.
const RequesterSeriesAddInput = z.strictObject({
  tvdbId: z.number().int().positive(),
});

// Admins send every choice the add panel shows. All fields are required, and strictObject rejects any other key.
const AdminSeriesAddInput = z.strictObject({
  tvdbId: z.number().int().positive(),
  qualityProfileId: z.number().int().positive(),
  rootFolderId: z.number().int().positive(),
  monitor: z.enum(SERIES_MONITOR_OPTIONS),
  seriesType: z.enum(SERIES_TYPE_OPTIONS),
  seasonFolder: z.boolean(),
  searchForMissingEpisodes: z.boolean(),
});

/** One add, as the action sees it after the role check. The requested ids and choices are set for an admin only. */
type SeriesAddRequest = {
  tvdbId: number;
  requestedProfileId?: number;
  requestedRootFolderId?: number;
  monitor?: SeriesMonitor;
  seriesType?: SeriesTypeOption;
  seasonFolder?: boolean;
  searchForMissingEpisodes?: boolean;
};

/**
 * Adds one TVDB series to the Sonarr library. A requester sends only the TVDB id, and the saved Add defaults decide
 * the profile and folder (or the first item when those are missing), with the saved monitor (or "all"), the standard
 * series type, season folders on and search on. An admin sends every choice the add panel shows. Same shape as the
 * other actions: the role check runs first inside try, and the catch always returns or throws.
 */
export async function addLibrarySeries(input: unknown): Promise<AddResult> {
  try {
    const { user } = await requireRole("admin", "requester");
    return await addLibrarySeriesAs(user.role === "admin", input);
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to add series." };
    throw error;
  }
}

/** The add itself, once the role is known. The role check above has already run. */
async function addLibrarySeriesAs(isAdmin: boolean, input: unknown): Promise<AddResult> {
  let request: SeriesAddRequest;
  if (isAdmin) {
    const parsed = AdminSeriesAddInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid add." };
    request = {
      tvdbId: parsed.data.tvdbId,
      requestedProfileId: parsed.data.qualityProfileId,
      requestedRootFolderId: parsed.data.rootFolderId,
      monitor: parsed.data.monitor,
      seriesType: parsed.data.seriesType,
      seasonFolder: parsed.data.seasonFolder,
      searchForMissingEpisodes: parsed.data.searchForMissingEpisodes,
    };
  } else {
    const parsed = RequesterSeriesAddInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid add." };
    request = { tvdbId: parsed.data.tvdbId };
  }
  const { tvdbId, requestedProfileId, requestedRootFolderId } = request;

  // Set by addSeries's onSend, just before the add request goes out. Only a timeout after that point can mean
  // Sonarr added the series; a timeout in the lookup or the library check before it cannot.
  let addSent = false;
  try {
    const [profiles, folders] = await Promise.all([listSeriesQualityProfiles(), listSeriesRootFolders()]);
    const saved = getSeriesAddDefaults();
    const target = resolveAddTarget({
      app: "Sonarr",
      noun: "series",
      profiles,
      folders,
      saved: { profileId: saved.profileId, rootFolderId: saved.rootFolderId },
      requestedProfileId,
      requestedRootFolderId,
    });
    if (!target.ok) return { ok: false, error: target.error };

    const added = await addSeries(
      {
        tvdbId,
        qualityProfileId: target.qualityProfileId,
        rootFolderPath: target.rootFolderPath,
        // Requesters get the saved defaults; an admin's panel choices are used as sent.
        monitor: request.monitor ?? saved.monitor ?? "all",
        seriesType: request.seriesType ?? "standard",
        seasonFolder: request.seasonFolder ?? true,
        searchForMissingEpisodes: request.searchForMissingEpisodes ?? true,
      },
      () => {
        addSent = true;
      },
    );
    // The library reads Sonarr on every request, so refresh() is enough for the new row to appear.
    refresh();
    return { ok: true, id: added.id, title: added.title, year: added.year };
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

/** startedIds is set when a multi-series search stops partway: the series Sonarr did accept. */
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
    // Earlier searches were accepted, so stop here rather than send more.
    if (startedIds.length > 0) {
      const progress = `Sonarr started searches for ${startedIds.length} of ${seriesIds.length} series`;
      // After a timeout Sonarr may have queued that search too, so don't call it failed.
      const next =
        error.kind === "timeout" ? "then took too long on the next one, which may also have started" : "then the next one failed";
      return {
        ok: false,
        error: `${progress}, ${next}. Check Sonarr before searching the rest.`,
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

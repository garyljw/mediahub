import "server-only";

import { refresh } from "next/cache";
import { z } from "zod";
import { SERIES_MONITOR_OPTIONS, SERIES_TYPE_OPTIONS, type SeriesMonitor, type SeriesTypeOption } from "@/components/tv/series-add";
import { ArrRequestError } from "@/server/arr/request";
import { SeriesAddError, addSeries, listSeriesRootFolders } from "@/server/arr/series-add";
import { listSeriesQualityProfiles } from "@/server/arr/series";
import { getSeriesAddDefaults } from "@/server/settings/add-defaults";
import { resolveAddTarget } from "@/server/settings/add-target";

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
 * The add itself, once the role is known. Callers check the role first (requireRole) and pass whether the caller is an
 * admin. A requester sends only the TVDB id, and the saved Add defaults decide the profile and folder (or the first item
 * when those are missing), with the saved monitor (or "all"), the standard series type, season folders on and search on.
 * An admin sends every choice the add panel shows. The catch maps every failure to a message, and only anything else is
 * rethrown.
 */
export async function addSeriesAs(isAdmin: boolean, input: unknown): Promise<AddResult> {
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

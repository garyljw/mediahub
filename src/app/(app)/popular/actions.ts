"use server";

import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { addSeriesAs, type AddResult } from "@/server/add/series-add";
import { getTmdbConfig } from "@/server/settings/tmdb";
import { getTvdbId } from "@/server/tmdb/client";
import { TmdbRequestError, tmdbFailureFor } from "@/server/tmdb/errors";
import { SERIES_MONITOR_OPTIONS, SERIES_TYPE_OPTIONS } from "@/components/tv/series-add";

export type { AddResult };

// A requester sends only the TMDB id. An admin also sends every choice the add panel shows, as on the Add page.
// strictObject rejects any other key, so a requester cannot pick a profile, a folder or a series type.
const TmdbId = z.number().int().positive().max(100_000_000);
const RequesterInput = z.strictObject({ tmdbId: TmdbId });
const AdminInput = z.strictObject({
  tmdbId: TmdbId,
  qualityProfileId: z.number().int().positive(),
  rootFolderId: z.number().int().positive(),
  monitor: z.enum(SERIES_MONITOR_OPTIONS),
  seriesType: z.enum(SERIES_TYPE_OPTIONS),
  seasonFolder: z.boolean(),
  searchForMissingEpisodes: z.boolean(),
});

/**
 * Adds a series found on the Popular page, which knows it only by its TMDB id. Sonarr adds by TVDB id, so TMDB's
 * external ids give that first. The add itself, and the Add defaults, are addSeriesAs, shared with the Add page.
 * Same shape as the other actions: the role check runs first inside try, and the catch always returns or throws.
 */
export async function addPopularSeries(input: unknown): Promise<AddResult> {
  try {
    const { user } = await requireRole("admin", "requester");
    return await addPopularSeriesAs(user.role === "admin", input);
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to add series." };
    throw error;
  }
}

async function addPopularSeriesAs(isAdmin: boolean, input: unknown): Promise<AddResult> {
  const parsed = (isAdmin ? AdminInput : RequesterInput).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid add." };
  const { tmdbId, ...choices } = parsed.data;

  const config = getTmdbConfig();
  if (config === null) return { ok: false, error: "TMDB isn't set up." };

  let tvdbId: number | null;
  try {
    tvdbId = await getTvdbId(config.token, tmdbId);
  } catch (error) {
    if (!(error instanceof TmdbRequestError)) throw error;
    // TmdbRequestError messages never contain the host, token, URL or response body, so they are safe to log.
    console.error(`Popular add: ${error.message}`);
    return { ok: false, error: tmdbFailureFor(error, isAdmin) };
  }
  if (tvdbId === null) return { ok: false, error: "Sonarr can't add this show yet (no TVDB entry)." };

  return addSeriesAs(isAdmin, { ...choices, tvdbId });
}

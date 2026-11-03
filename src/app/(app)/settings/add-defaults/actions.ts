"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { listQualityProfiles } from "@/server/arr/movies";
import { listRootFolders } from "@/server/arr/movie-add";
import { listSeriesQualityProfiles } from "@/server/arr/series";
import { listSeriesRootFolders } from "@/server/arr/series-add";
import { ArrRequestError } from "@/server/arr/request";
import { saveMovieAddDefaults, saveSeriesAddDefaults } from "@/server/settings/add-defaults";
import { SERIES_MONITOR_OPTIONS } from "@/components/tv/series-add";

export type DefaultsResult = { ok: true } | { ok: false; message: string };

const DENIED = "You don't have permission to change add defaults.";

// strictObject rejects unknown keys. Only ids (and the monitor for series) cross from the browser.
const MovieDefaultsInput = z.strictObject({
  profileId: z.number().int().positive(),
  rootFolderId: z.number().int().positive(),
});

const SeriesDefaultsInput = z.strictObject({
  profileId: z.number().int().positive(),
  rootFolderId: z.number().int().positive(),
  monitor: z.enum(SERIES_MONITOR_OPTIONS),
});

const INVALID_MOVIE = "Choose a quality profile and root folder.";
const INVALID_SERIES = "Choose a quality profile, root folder and monitor option.";

/**
 * Saves the Radarr add defaults (admin only). The role check runs first, inside try. Both ids must still exist
 * in Radarr's live lists, so a stale choice is never stored.
 */
export async function saveMovieDefaults(input: unknown): Promise<DefaultsResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const parsed = MovieDefaultsInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID_MOVIE };
  const { profileId, rootFolderId } = parsed.data;

  try {
    const [profiles, folders] = await Promise.all([listQualityProfiles(), listRootFolders()]);
    if (!profiles.some((profile) => profile.id === profileId) || !folders.some((folder) => folder.id === rootFolderId)) {
      return { ok: false, message: "That quality profile or root folder no longer exists in Radarr." };
    }
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Add defaults (Radarr): ${error.message}`);
    return { ok: false, message: "Couldn't reach Radarr." };
  }

  saveMovieAddDefaults({ profileId, rootFolderId });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Saves the Sonarr add defaults (admin only). The role check runs first, inside try. Both ids must still exist
 * in Sonarr's live lists, so a stale choice is never stored.
 */
export async function saveSeriesDefaults(input: unknown): Promise<DefaultsResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const parsed = SeriesDefaultsInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID_SERIES };
  const { profileId, rootFolderId, monitor } = parsed.data;

  try {
    const [profiles, folders] = await Promise.all([listSeriesQualityProfiles(), listSeriesRootFolders()]);
    if (!profiles.some((profile) => profile.id === profileId) || !folders.some((folder) => folder.id === rootFolderId)) {
      return { ok: false, message: "That quality profile or root folder no longer exists in Sonarr." };
    }
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Add defaults (Sonarr): ${error.message}`);
    return { ok: false, message: "Couldn't reach Sonarr." };
  }

  saveSeriesAddDefaults({ profileId, rootFolderId, monitor });
  revalidatePath("/", "layout");
  return { ok: true };
}

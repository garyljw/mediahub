import "server-only";

import { listQualityProfiles } from "@/server/arr/movies";
import { listRootFolders } from "@/server/arr/movie-add";
import { listSeriesQualityProfiles } from "@/server/arr/series";
import { listSeriesRootFolders } from "@/server/arr/series-add";
import type { QualityProfileOption } from "@/server/arr/profiles";
import type { RootFolderOption } from "@/server/arr/root-folders";
import { ArrRequestError } from "@/server/arr/request";
import { getMovieAddDefaults, getSeriesAddDefaults } from "@/server/settings/add-defaults";
import type { AddOptionsForApp, MovieFormDefaults, SeriesFormDefaults } from "@/components/add/add-results";

/**
 * One app's options for the admin panel. A request failure is logged and reported as null, so that app's panel
 * says it couldn't load. Anything that isn't a request failure is rethrown.
 */
async function loadOptions<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`${label}: ${error.message}`);
    return null;
  }
}

/** Only ids, names and paths cross to the browser. Nothing else from Radarr or Sonarr is sent. */
function toOptions<Defaults>(
  profiles: QualityProfileOption[],
  folders: RootFolderOption[],
  defaults: Defaults,
): AddOptionsForApp<Defaults> {
  return {
    profiles: profiles.map(({ id, name }) => ({ id, name })),
    folders: folders.map(({ id, path }) => ({ id, path })),
    defaults,
  };
}

async function loadRadarr(): Promise<AddOptionsForApp<MovieFormDefaults>> {
  const [profiles, folders] = await Promise.all([listQualityProfiles(), listRootFolders()]);
  return toOptions(profiles, folders, getMovieAddDefaults());
}

async function loadSonarr(): Promise<AddOptionsForApp<SeriesFormDefaults>> {
  const [profiles, folders] = await Promise.all([listSeriesQualityProfiles(), listSeriesRootFolders()]);
  return toOptions(profiles, folders, getSeriesAddDefaults());
}

/**
 * Radarr's add options for the admin panel: profiles, folders and the saved defaults. `label` names the caller in the
 * log line when Radarr can't be read. Null when the request failed.
 */
export function loadMovieAddOptions(label: string): Promise<AddOptionsForApp<MovieFormDefaults> | null> {
  return loadOptions(`${label} (Radarr)`, loadRadarr);
}

/**
 * Sonarr's add options for the admin panel: profiles, folders and the saved defaults. `label` names the caller in the
 * log line when Sonarr can't be read. Null when the request failed.
 */
export function loadSeriesAddOptions(label: string): Promise<AddOptionsForApp<SeriesFormDefaults> | null> {
  return loadOptions(`${label} (Sonarr)`, loadSonarr);
}

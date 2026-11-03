import Link from "next/link";
import { requirePageUser } from "@/server/authz";
import { listQualityProfiles } from "@/server/arr/movies";
import { listRootFolders } from "@/server/arr/movie-add";
import { listSeriesQualityProfiles } from "@/server/arr/series";
import { listSeriesRootFolders } from "@/server/arr/series-add";
import type { QualityProfileOption } from "@/server/arr/profiles";
import type { RootFolderOption } from "@/server/arr/root-folders";
import { ArrRequestError } from "@/server/arr/request";
import { getMovieAddDefaults, getSeriesAddDefaults } from "@/server/settings/add-defaults";
import { AddSearch } from "@/components/add/add-search";
import type { AddOptionsForApp, MovieFormDefaults, SeriesFormDefaults } from "@/components/add/add-results";

export const metadata = { title: "Add" };
// Blocking route: an admin's page waits for Radarr and Sonarr before rendering, so no Suspense fallback is needed.
export const instant = false;

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
    console.error(`Add page (${label}): ${error.message}`);
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

export default async function AddPage() {
  const user = await requirePageUser("admin", "requester");
  const isAdmin = user.role === "admin";

  // Requesters load nothing from Arr. Admins load each app separately, so one app's failure doesn't hide the other.
  const [movieOptions, seriesOptions] = isAdmin
    ? await Promise.all([loadOptions("Radarr", loadRadarr), loadOptions("Sonarr", loadSonarr)])
    : [null, null];

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Home
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add</h1>
      <AddSearch isAdmin={isAdmin} movieOptions={movieOptions} seriesOptions={seriesOptions} />
    </div>
  );
}

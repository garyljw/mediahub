import Link from "next/link";
import type { ReactNode } from "react";
import { requirePageUser } from "@/server/authz";
import { listQualityProfiles } from "@/server/arr/movies";
import type { QualityProfileOption } from "@/server/arr/profiles";
import { listRootFolders } from "@/server/arr/movie-add";
import { listSeriesQualityProfiles } from "@/server/arr/series";
import { listSeriesRootFolders } from "@/server/arr/series-add";
import type { RootFolderOption } from "@/server/arr/root-folders";
import { ArrRequestError } from "@/server/arr/request";
import { getConnection, type ArrApp } from "@/server/settings/connections";
import { getMovieAddDefaults, getSeriesAddDefaults } from "@/server/settings/add-defaults";
import { AddDefaultsForm, type DefaultsFolder, type DefaultsProfile } from "@/components/settings/add-defaults-form";

export const metadata = { title: "Add defaults" };
// The page waits for Radarr and Sonarr before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

const NAMES: Record<ArrApp, string> = { radarr: "Radarr", sonarr: "Sonarr" };

type Loaded = { profiles: DefaultsProfile[]; folders: DefaultsFolder[] };

/** Only {id, name} and {id, path} cross to the browser. Nothing else from Radarr or Sonarr is sent. */
function toLoaded(profiles: QualityProfileOption[], folders: RootFolderOption[]): Loaded {
  return {
    profiles: profiles.map(({ id, name }) => ({ id, name })),
    folders: folders.map(({ id, path }) => ({ id, path })),
  };
}

async function fetchOptions(app: ArrApp): Promise<Loaded> {
  if (app === "radarr") {
    const [profiles, folders] = await Promise.all([listQualityProfiles(), listRootFolders()]);
    return toLoaded(profiles, folders);
  }
  const [profiles, folders] = await Promise.all([listSeriesQualityProfiles(), listSeriesRootFolders()]);
  return toLoaded(profiles, folders);
}

/**
 * The lists for one app's form. A request failure is logged and reported as null. Anything that isn't a
 * request failure is rethrown.
 */
async function loadOptions(app: ArrApp): Promise<Loaded | null> {
  try {
    return await fetchOptions(app);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Add defaults page (${NAMES[app]}): ${error.message}`);
    return null;
  }
}

function AppSection({ app, children }: { app: ArrApp; children: ReactNode }) {
  return (
    <section className="rounded-lg border p-5">
      <h2 className="text-lg font-semibold">{NAMES[app]}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function AddDefaultsPage() {
  await requirePageUser("admin");
  const movieDefaults = getMovieAddDefaults();
  const seriesDefaults = getSeriesAddDefaults();

  // Loaded together, so a slow app doesn't hold up the other.
  const [radarr, sonarr] = await Promise.all(
    (["radarr", "sonarr"] as const).map((app) =>
      getConnection(app) === null ? ("unconfigured" as const) : loadOptions(app),
    ),
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Add defaults</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The quality profile and root folder that new movies and series are added with. Requesters always use these, and admins start with the profile.
      </p>
      <div className="mt-6 space-y-6">
        <AppSection app="radarr">
          {radarr === "unconfigured" ? (
            <SetUpFirst app="radarr" />
          ) : radarr === null ? (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t load options from Radarr.
            </p>
          ) : (
            <AddDefaultsForm app="radarr" profiles={radarr.profiles} folders={radarr.folders} initial={movieDefaults} />
          )}
        </AppSection>
        <AppSection app="sonarr">
          {sonarr === "unconfigured" ? (
            <SetUpFirst app="sonarr" />
          ) : sonarr === null ? (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t load options from Sonarr.
            </p>
          ) : (
            <AddDefaultsForm
              app="sonarr"
              profiles={sonarr.profiles}
              folders={sonarr.folders}
              initial={seriesDefaults}
            />
          )}
        </AppSection>
      </div>
    </div>
  );
}

function SetUpFirst({ app }: { app: ArrApp }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Set up the {NAMES[app]} connection first.</p>
      <Link href="/settings/connections" className="text-sm font-medium underline">
        Go to Connections
      </Link>
    </div>
  );
}

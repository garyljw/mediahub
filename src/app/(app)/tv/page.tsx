import { requirePageUser } from "@/server/authz";
import { listSeries } from "@/server/arr/series";
import { listSeriesRootFolders } from "@/server/arr/series-add";
import type { RootFolderOption } from "@/server/arr/root-folders";
import { ArrRequestError } from "@/server/arr/request";
import { SeriesTable } from "@/components/tv/series-table";
import { SeriesAddDialog } from "@/components/tv/series-add-dialog";

export const metadata = { title: "TV" };
// Blocking route: the page waits for Sonarr before rendering, so no Suspense fallback is needed.
export const instant = false;

/**
 * Root folders for the add dialog. A Sonarr failure here must not take the whole page down, so it is
 * logged and reported as null. Anything that isn't a Sonarr request failure is rethrown.
 */
async function loadRootFolders(): Promise<RootFolderOption[] | null> {
  try {
    return await listSeriesRootFolders();
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`TV page: ${error.message}`);
    return null;
  }
}

export default async function TVPage() {
  const user = await requirePageUser("admin", "requester");

  let library: Awaited<ReturnType<typeof listSeries>>;
  let rootFolders: RootFolderOption[] | null;
  try {
    [library, rootFolders] = await Promise.all([listSeries(), loadRootFolders()]);
  } catch (error) {
    // Anything that isn't a Sonarr request failure (a config error, a bug) goes to Next's error
    // handling instead of being disguised as a Sonarr outage.
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`TV page: ${error.message}`);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">TV</h1>
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load series from Sonarr.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">TV</h1>
        <SeriesAddDialog profiles={library.profiles} rootFolders={rootFolders} />
      </div>
      <SeriesTable rows={library.rows} profiles={library.profiles} isAdmin={user.role === "admin"} />
    </div>
  );
}

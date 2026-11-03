import { requirePageUser } from "@/server/authz";
import { listSeries } from "@/server/arr/series";
import { ArrRequestError } from "@/server/arr/request";
import { SeriesTable } from "@/components/tv/series-table";

export const metadata = { title: "TV" };
// Blocking route: the page waits for Sonarr before rendering, so no Suspense fallback is needed.
export const instant = false;

export default async function TVPage() {
  const user = await requirePageUser("admin", "requester");

  let library: Awaited<ReturnType<typeof listSeries>>;
  try {
    library = await listSeries();
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
      <h1 className="text-2xl font-semibold tracking-tight">TV</h1>
      <SeriesTable rows={library.rows} profiles={library.profiles} isAdmin={user.role === "admin"} />
    </div>
  );
}

import { requirePageUser } from "@/server/authz";
import { listMovies } from "@/server/arr/movies";
import { ArrRequestError } from "@/server/arr/request";
import { MoviesTable } from "@/components/movies/movies-table";

export const metadata = { title: "Movies" };
// Blocking route: the page waits for Radarr before rendering, so no Suspense fallback is needed.
export const instant = false;

export default async function MoviesPage() {
  await requirePageUser("admin", "requester");

  let library: Awaited<ReturnType<typeof listMovies>>;
  try {
    library = await listMovies();
  } catch (error) {
    // Anything that isn't a Radarr request failure (a config error, a bug) goes to Next's error
    // handling instead of being disguised as a Radarr outage.
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movies page: ${error.message}`);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Movies</h1>
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load movies from Radarr.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Movies</h1>
      <MoviesTable rows={library.rows} profiles={library.profiles} />
    </div>
  );
}

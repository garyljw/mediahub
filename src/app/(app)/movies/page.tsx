import { requirePageUser } from "@/server/authz";
import { listMovies } from "@/server/arr/movies";
import { listRootFolders } from "@/server/arr/movie-add";
import { ArrRequestError } from "@/server/arr/request";
import { MoviesTable } from "@/components/movies/movies-table";
import { MovieAddDialog } from "@/components/movies/movie-add-dialog";

export const metadata = { title: "Movies" };
// Blocking route: the page waits for Radarr before rendering, so no Suspense fallback is needed.
export const instant = false;

export default async function MoviesPage() {
  const user = await requirePageUser("admin", "requester");

  let library: Awaited<ReturnType<typeof listMovies>>;
  let rootFolders: Awaited<ReturnType<typeof listRootFolders>>;
  try {
    [library, rootFolders] = await Promise.all([listMovies(), listRootFolders()]);
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Movies</h1>
        <MovieAddDialog profiles={library.profiles} rootFolders={rootFolders} />
      </div>
      <MoviesTable rows={library.rows} profiles={library.profiles} isAdmin={user.role === "admin"} />
    </div>
  );
}

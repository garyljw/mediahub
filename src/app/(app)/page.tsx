import { requirePageUser } from "@/server/authz";
import { listMovies } from "@/server/arr/movies";
import { listSeries } from "@/server/arr/series";
import { ArrRequestError } from "@/server/arr/request";
import { toHomeItems } from "@/server/merge/library";
import { HomeGrid } from "@/components/home/home-grid";

export const metadata = { title: "Home" };
// Blocking route: the page waits for both apps before rendering, so no Suspense fallback is needed.
export const instant = false;

/**
 * Loads one app's library for the Home grid. An Arr request failure must not take the other app down, so it is
 * logged and reported as null. Anything that isn't a request failure is rethrown.
 */
async function loadOrNull<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Home page: ${error.message}`);
    return null;
  }
}

export default async function HomePage() {
  await requirePageUser("admin", "requester");

  const [movies, series] = await Promise.all([loadOrNull(listMovies), loadOrNull(listSeries)]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
      {movies === null && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load movies from Radarr.
        </p>
      )}
      {series === null && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load TV from Sonarr.
        </p>
      )}
      {(movies !== null || series !== null) && (
        <HomeGrid
          items={toHomeItems(movies?.rows ?? [], series?.rows ?? [])}
          unavailable={[...(movies === null ? ["movie" as const] : []), ...(series === null ? ["series" as const] : [])]}
        />
      )}
    </div>
  );
}

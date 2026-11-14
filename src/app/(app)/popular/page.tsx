import Link from "next/link";
import { Suspense } from "react";
import { requirePageUser } from "@/server/authz";
import { listMovies } from "@/server/arr/movies";
import { listSeries } from "@/server/arr/series";
import { loadOrNull } from "@/server/arr/load-or-null";
import { loadMovieAddOptions, loadSeriesAddOptions } from "@/server/add/add-options";
import { getTmdbConfig } from "@/server/settings/tmdb";
import { libraryByTmdbId } from "@/server/merge/popular";
import { PopularPlace } from "@/components/popular/popular-place";
import { parsePopularParams } from "@/components/popular/popular-params";
import { PopularServiceSkeleton, PosterGridSkeleton } from "@/components/skeletons/page-skeletons";
import { loadGenres, PopularOnService, TrendingMovies, TrendingShows, UpcomingMovies, UpcomingShows, ShowsOnThisWeek, type PopularContext } from "./sections";

export const metadata = { title: "Popular" };
// The page waits only for the role check and the address. Each section streams in when TMDB (and Radarr or Sonarr)
// answers, behind its own skeleton, so one slow or failed list doesn't hold up the rest. loading.tsx covers the check.
export const instant = false;

/** Never rejects: a failure gives null, which the section shows as an error. The log line is fixed text. */
function settle<T>(promise: Promise<T | null>, what: string): Promise<T | null> {
  return promise.catch(() => {
    console.error(`Popular page: ${what} could not be loaded`);
    return null;
  });
}

export default async function PopularPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string | string[] | undefined; kind?: string | string[] | undefined }>;
}) {
  const user = await requirePageUser("admin", "requester");
  const isAdmin = user.role === "admin";
  const config = getTmdbConfig();

  if (config === null) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Popular</h1>
        {isAdmin ? (
          <p className="text-sm text-muted-foreground">
            <Link href="/settings/connections" className="text-primary underline">
              Add a TMDB token in Settings → Connections
            </Link>{" "}
            to see what&apos;s popular.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Popular isn&apos;t set up yet.</p>
        )}
      </div>
    );
  }

  const params = parsePopularParams(await searchParams);

  // Nothing here is awaited. Radarr and Sonarr (and, for an admin, their Add options) start now, and the sections
  // await what they need.
  const ctx: PopularContext = {
    token: config.token,
    region: config.region,
    language: config.language,
    isAdmin,
    movieLibrary: settle(
      loadOrNull(listMovies, "Popular page").then((movies) => (movies === null ? null : libraryByTmdbId(movies.rows))),
      "the movie library",
    ),
    seriesLibrary: settle(
      loadOrNull(listSeries, "Popular page").then((series) => (series === null ? null : libraryByTmdbId(series.rows))),
      "the series library",
    ),
    movieGenres: loadGenres(config.token, "movie"),
    showGenres: loadGenres(config.token, "tv"),
    movieOptions: isAdmin ? settle(loadMovieAddOptions("Popular page"), "Radarr's Add options") : Promise.resolve(null),
    seriesOptions: isAdmin ? settle(loadSeriesAddOptions("Popular page"), "Sonarr's Add options") : Promise.resolve(null),
  };

  return (
    <PopularPlace>
      <h1 className="text-2xl font-semibold tracking-tight">Popular</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Trending movies</h2>
        <Suspense fallback={<PosterGridSkeleton count={12} />}>
          <TrendingMovies ctx={ctx} />
        </Suspense>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Trending TV</h2>
        <Suspense fallback={<PosterGridSkeleton count={12} />}>
          <TrendingShows ctx={ctx} />
        </Suspense>
      </section>

      <section className="space-y-3">
        <Suspense fallback={<PopularServiceSkeleton />}>
          <PopularOnService ctx={ctx} params={params} />
        </Suspense>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Upcoming movies</h2>
        <Suspense fallback={<PosterGridSkeleton count={12} />}>
          <UpcomingMovies ctx={ctx} />
        </Suspense>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Upcoming TV</h2>
        <Suspense fallback={<PosterGridSkeleton count={12} />}>
          <UpcomingShows ctx={ctx} />
        </Suspense>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">On this week</h2>
        <Suspense fallback={<PosterGridSkeleton count={12} />}>
          <ShowsOnThisWeek ctx={ctx} />
        </Suspense>
      </section>

      <p className="text-xs text-muted-foreground">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </PopularPlace>
  );
}

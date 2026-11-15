import "server-only";
import Link from "next/link";
import { Suspense } from "react";
import type { AddOptionsForApp, MovieFormDefaults, SeriesFormDefaults } from "@/components/add/add-results";
import { popularHref, type PopularParams } from "@/components/popular/popular-params";
import { SectionSettled } from "@/components/popular/popular-place";
import type { PopularSectionId } from "@/components/popular/popular-sections";
import { PopularTiles } from "@/components/popular/popular-tiles";
import { PosterGridSkeleton } from "@/components/skeletons/page-skeletons";
import { chipClass } from "@/components/library/chip";
import {
  chooseService,
  movieTiles,
  offeredServices,
  showTiles,
  type PopularTile,
} from "@/server/merge/popular";
import {
  discoverMovies,
  getGenres,
  discoverShows,
  getProviders,
  getTrendingMovies,
  getTrendingShows,
  getShowsOnThisWeek,
  getUpcomingMovies,
  getUpcomingShows,
} from "@/server/tmdb/client";
import { getChosenServices } from "@/server/settings/tmdb";
import { TmdbRequestError, tmdbFailureFor } from "@/server/tmdb/errors";
import type { TmdbMovie, TmdbShow } from "@/server/tmdb/schemas";

/**
 * What the Popular sections share. The library and the admin's Add options are started once by the page, and each
 * section awaits the ones it needs. None of the promises rejects: a failure is null, and the section says so.
 */
export type PopularContext = {
  token: string;
  region: string;
  language: string;
  isAdmin: boolean;
  movieLibrary: Promise<Map<number, number> | null>;
  seriesLibrary: Promise<Map<number, number> | null>;
  /** Genre names for the hover cards, one call per kind per page view. A failed call gives an empty map. */
  movieGenres: Promise<Map<number, string>>;
  showGenres: Promise<Map<number, string>>;
  movieOptions: Promise<AddOptionsForApp<MovieFormDefaults> | null>;
  seriesOptions: Promise<AddOptionsForApp<SeriesFormDefaults> | null>;
};

/** One TMDB list. `load` gives a function that marks its tiles against a library, so the kinds are checked by type. */
type Source = { id: PopularSectionId; isMovie: boolean; load: () => Promise<(library: ReadonlyMap<number, number>) => PopularTile[]> };

function movieSource(id: PopularSectionId, genres: Promise<Map<number, string>>, load: () => Promise<TmdbMovie[]>): Source {
  return {
    id,
    isMovie: true,
    load: async () => {
      const [items, names] = await Promise.all([load(), genres]);
      return (library) => movieTiles(items, library, names);
    },
  };
}

function showSource(id: PopularSectionId, genres: Promise<Map<number, string>>, load: () => Promise<TmdbShow[]>): Source {
  return {
    id,
    isMovie: false,
    load: async () => {
      const [items, names] = await Promise.all([load(), genres]);
      return (library) => showTiles(items, library, names);
    },
  };
}

/** A TMDB failure as the page words it, and whether the saved token is the cause (admins get a Settings link). */
function failureMessage(error: unknown, isAdmin: boolean): { message: string; tokenRefused: boolean } {
  if (!(error instanceof TmdbRequestError)) throw error;
  // TmdbRequestError messages never contain the host, token, URL or response body, so they are safe to log.
  console.error(`Popular page: ${error.message}`);
  return { message: tmdbFailureFor(error, isAdmin), tokenRefused: error.kind === "http" && error.status === 401 };
}

/** Genre names for the hover cards. A failed call is logged once and gives none, so the cards lose their genres and no section fails. */
export async function loadGenres(token: string, kind: "movie" | "tv"): Promise<Map<number, string>> {
  try {
    return await getGenres(token, kind);
  } catch (error) {
    failureMessage(error, false);
    return new Map();
  }
}

function SectionError({ message, tokenRefused, isAdmin }: { message: string; tokenRefused: boolean; isAdmin: boolean }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
      {tokenRefused && isAdmin && (
        <>
          {" "}
          <Link href="/settings/connections" className="underline">
            Open Settings
          </Link>
        </>
      )}
    </p>
  );
}

/** Used when the library couldn't be read: no tile is marked. */
const NO_LIBRARY: ReadonlyMap<number, number> = new Map();

/** The tiles of one TMDB list, marked against the library. Its own failure shows here and nowhere else. */
async function TileList({ ctx, source }: { ctx: PopularContext; source: Source }) {
  const { isMovie } = source;
  const [tmdb, library, movieOptions, seriesOptions] = await Promise.all([
    source.load().then(
      (mark) => ({ mark }),
      (error: unknown) => ({ failure: failureMessage(error, ctx.isAdmin) }),
    ),
    isMovie ? ctx.movieLibrary : ctx.seriesLibrary,
    ctx.isAdmin && isMovie ? ctx.movieOptions : null,
    ctx.isAdmin && !isMovie ? ctx.seriesOptions : null,
  ]);
  if ("failure" in tmdb) {
    return (
      <>
        <SectionError {...tmdb.failure} isAdmin={ctx.isAdmin} />
        <SectionSettled section={source.id} />
      </>
    );
  }
  const tiles = tmdb.mark(library ?? NO_LIBRARY);
  const note = library === null && (
    <p role="status" className="mb-3 text-sm text-muted-foreground">
      Couldn&apos;t check your library in {isMovie ? "Radarr" : "Sonarr"}.
    </p>
  );
  if (tiles.length === 0) {
    return (
      <>
        {note}
        <p className="text-sm text-muted-foreground">Nothing to show right now.</p>
        <SectionSettled section={source.id} />
      </>
    );
  }
  return (
    <>
      {note}
      <PopularTiles section={source.id} tiles={tiles} isAdmin={ctx.isAdmin} movieOptions={movieOptions} seriesOptions={seriesOptions} />
    </>
  );
}

export async function TrendingMovies({ ctx }: { ctx: PopularContext }) {
  return <TileList ctx={ctx} source={movieSource("trending-movies", ctx.movieGenres, () => getTrendingMovies(ctx.token))} />;
}

export async function TrendingShows({ ctx }: { ctx: PopularContext }) {
  return <TileList ctx={ctx} source={showSource("trending-tv", ctx.showGenres, () => getTrendingShows(ctx.token))} />;
}

export async function UpcomingMovies({ ctx }: { ctx: PopularContext }) {
  return <TileList ctx={ctx} source={movieSource("upcoming-movies", ctx.movieGenres, () => getUpcomingMovies(ctx.token, ctx.region))} />;
}

export async function UpcomingShows({ ctx }: { ctx: PopularContext }) {
  return <TileList ctx={ctx} source={showSource("upcoming-tv", ctx.showGenres, () => getUpcomingShows(ctx.token, ctx.language))} />;
}

export async function ShowsOnThisWeek({ ctx }: { ctx: PopularContext }) {
  return <TileList ctx={ctx} source={showSource("this-week", ctx.showGenres, () => getShowsOnThisWeek(ctx.token, ctx.language))} />;
}

/**
 * "Popular on [service]": the stored country's streaming services (the most prominent twelve), a Movies/TV switch, and
 * that service's most popular titles. The choice lives in the address, so it survives a reload and can be shared. The
 * picker shows as soon as the services are known; the list loads under it.
 */
export async function PopularOnService({ ctx, params }: { ctx: PopularContext; params: PopularParams }) {
  const { mode } = params;
  const chosenIds = getChosenServices();
  let services;
  try {
    // Only the shown kind's services: a service may stream movies but not TV in this country.
    services = offeredServices(await getProviders(ctx.token, mode, ctx.region), ctx.region, chosenIds);
  } catch (error) {
    const failure = failureMessage(error, ctx.isAdmin);
    return (
      <>
        <h2 className="text-lg font-semibold tracking-tight">Popular on a service</h2>
        <SectionError {...failure} isAdmin={ctx.isAdmin} />
        <SectionSettled section="service" />
      </>
    );
  }
  const chosen = chooseService(services, params.service, chosenIds.length === 0);
  if (chosen === null) {
    return (
      <>
        <h2 className="text-lg font-semibold tracking-tight">Popular on a service</h2>
        <p className="text-sm text-muted-foreground">
          {chosenIds.length === 0 ? (
            "TMDB lists no streaming services for this country."
          ) : (
            <>
              None of the chosen services has {mode === "movie" ? "movies" : "TV"} in this country.
              {ctx.isAdmin && (
                <>
                  {" "}
                  <Link href="/settings/popular" className="underline">
                    Change in Settings
                  </Link>
                </>
              )}
            </>
          )}
        </p>
        <SectionSettled section="service" />
      </>
    );
  }
  const source: Source =
    mode === "movie"
      ? movieSource("service", ctx.movieGenres, () => discoverMovies(ctx.token, ctx.region, chosen.id))
      : showSource("service", ctx.showGenres, () => discoverShows(ctx.token, ctx.region, chosen.id));
  return (
    <>
      <h2 className="text-lg font-semibold tracking-tight">Popular on {chosen.name}</h2>
      <div className="flex flex-col gap-2">
        <div role="group" aria-label="Streaming service" className="flex flex-wrap gap-2">
          {services.map((service) => (
            <Link
              key={service.id}
              href={popularHref(service.id, mode)}
              scroll={false}
              aria-current={service.id === chosen.id ? "true" : undefined}
              className={chipClass(service.id === chosen.id)}
            >
              {service.name}
            </Link>
          ))}
        </div>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {(["movie", "tv"] as const).map((option) => (
            <Link
              key={option}
              href={popularHref(chosen.id, option)}
              scroll={false}
              aria-current={option === mode ? "true" : undefined}
              className={chipClass(option === mode)}
            >
              {option === "movie" ? "Movies" : "TV"}
            </Link>
          ))}
        </div>
      </div>
      {/* Keyed, so changing the service or the switch shows the skeleton again instead of the old list. */}
      <Suspense key={`${chosen.id}-${mode}`} fallback={<PosterGridSkeleton count={12} />}>
        <TileList ctx={ctx} source={source} />
      </Suspense>
    </>
  );
}

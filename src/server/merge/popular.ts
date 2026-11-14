import "server-only";
import { toPeek, type Peek } from "./peek";
import {
  EXCLUDED_MOVIE_GENRES,
  EXCLUDED_TV_GENRES,
  type TmdbMovie,
  type TmdbProvider,
  type TmdbShow,
} from "@/server/tmdb/schemas";

// Turns TMDB lists into the tiles of the Popular page. Pure: the library is passed in, nothing is fetched here.

export type PopularKind = "movie" | "series";

/** One tile, with only the fields the UI needs. `posterFile` is a bare TMDB file name for the poster route. */
export type PopularTile = {
  tmdbId: number;
  kind: PopularKind;
  title: string;
  year: number | null;
  posterFile: string | null;
  /** The hover card's text, from TMDB. */
  peek: Peek;
  inLibrary: boolean;
  /** The Radarr or Sonarr id, for the link to the item's page. Null when not in the library. */
  libraryId: number | null;
};

/** A library title's TMDB id and its id in Radarr or Sonarr. Rows with no TMDB id can't be matched. */
export type LibraryRef = { id: number; tmdbId: number | null };

/** The library's TMDB id to Radarr/Sonarr id, for marking tiles. */
export function libraryByTmdbId(
  rows: readonly LibraryRef[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const row of rows) if (row.tmdbId !== null) map.set(row.tmdbId, row.id);
  return map;
}

/** The year from "YYYY-MM-DD", or null for a missing or odd date. Read from the text, so no time zone is involved. */
export function yearOf(date: string | null): number | null {
  const match = date === null ? null : /^(\d{4})-\d{2}-\d{2}$/.exec(date);
  return match === null ? null : Number(match[1]);
}

/** "/abc.jpg" to "abc.jpg". The poster route does the real validation of the name. */
function posterFileOf(path: string | null): string | null {
  return path === null ? null : path.replace(/^\//, "") || null;
}

function tile(
  kind: PopularKind,
  library: ReadonlyMap<number, number>,
  genres: ReadonlyMap<number, string>,
  base: {
    id: number;
    title: string;
    date: string | null;
    overview: string;
    posterPath: string | null;
    genreIds: number[];
  },
): PopularTile {
  const libraryId = library.get(base.id) ?? null;
  const year = yearOf(base.date);
  const names = base.genreIds.flatMap((id) => genres.get(id) ?? []);
  return {
    tmdbId: base.id,
    kind,
    title: base.title,
    year,
    posterFile: posterFileOf(base.posterPath),
    peek: toPeek({ year, genres: names, overview: base.overview }) ?? {
      year: null,
      genres: [],
      overview: "",
    },
    inLibrary: libraryId !== null,
    libraryId,
  };
}

export function movieTiles(
  movies: readonly TmdbMovie[],
  library: ReadonlyMap<number, number>,
  genres: ReadonlyMap<number, string>,
): PopularTile[] {
  // Some lists can't be filtered by TMDB (trending, upcoming movies), so excluded genres are dropped here, for every list.
  return movies
    .filter((m) => !m.genreIds.some((id) => EXCLUDED_MOVIE_GENRES.includes(id)))
    .map((m) =>
      tile("movie", library, genres, {
        id: m.id,
        title: m.title,
        date: m.releaseDate,
        overview: m.overview,
        posterPath: m.posterPath,
        genreIds: m.genreIds,
      }),
    );
}

export function showTiles(
  shows: readonly TmdbShow[],
  library: ReadonlyMap<number, number>,
  genres: ReadonlyMap<number, string>,
): PopularTile[] {
  return shows
    .filter((s) => !s.genreIds.some((id) => EXCLUDED_TV_GENRES.includes(id)))
    .map((s) =>
      tile("series", library, genres, {
        id: s.id,
        title: s.name,
        date: s.firstAirDate,
        overview: s.overview,
        posterPath: s.posterPath,
        genreIds: s.genreIds,
      }),
    );
}

/** How many services the picker offers. TMDB lists well over a hundred for a country, most of them obscure. */
export const SERVICE_LIMIT = 12;

/**
 * The services to offer for one kind (movies or TV) in a country: the most prominent first (TMDB's display priority for that country, then name),
 * cut to SERVICE_LIMIT. This is the only place the providers are sorted.
 */
export function popularServices(
  providers: readonly TmdbProvider[],
  region: string,
): TmdbProvider[] {
  // TMDB ranks services per country (display_priorities), and also has one global rank. The country's rank wins.
  const rank = (p: TmdbProvider) =>
    p.displayPriorities[region] ?? p.displayPriority;
  return [...providers]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, SERVICE_LIMIT);
}

/** The Netflix id, the default service when the country has it. */
const NETFLIX_ID = 8;

/** The requested service when it is on offer, else Netflix if offered, else the first. Null when there are none. */
export function chooseService(
  services: readonly TmdbProvider[],
  requestedId: number | null,
): TmdbProvider | null {
  return (
    services.find((s) => s.id === requestedId) ??
    services.find((s) => s.id === NETFLIX_ID) ??
    services[0] ??
    null
  );
}

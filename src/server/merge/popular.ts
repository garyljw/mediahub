import "server-only";
import { toPeek, type Peek } from "./peek";
import type { PopularInclude } from "@/components/settings/popular-includes";
import type { TmdbMovie, TmdbProvider, TmdbShow } from "@/server/tmdb/schemas";

// Turns TMDB lists into the tiles of the Popular page. Pure: the library is passed in, nothing is fetched here.

export type PopularKind = "movie" | "series";

// What the Popular page leaves out unless an admin includes it (TMDB ids): the movie genre, the TV genre and the TV show
// type of each category. Documentary is genre 99 for both kinds; TMDB files quiz and game shows under Reality (10764).
// One source for the upstream filters and for the merge that drops titles from lists TMDB can't filter.
const CATEGORY_IDS: Record<PopularInclude, { movieGenre?: number; tvGenre?: number; tvType?: number }> = {
  documentary: { movieGenre: 99, tvGenre: 99, tvType: 0 },
  news: { tvGenre: 10763, tvType: 1 },
  reality: { tvGenre: 10764, tvType: 3 },
  soap: { tvGenre: 10766 },
  talk: { tvGenre: 10767, tvType: 5 },
};

/** The show types "On this week" always asks for (Miniseries, Scripted, Video). */
const BASE_TV_TYPES = [2, 4, 6];

export type PopularFilters = { movieWithoutGenres: number[]; tvWithoutGenres: number[]; tvTypes: number[] };

/** The genres to leave out and the show types to ask for, given the categories an admin included. All sorted ascending. */
export function popularFilters(include: readonly PopularInclude[]): PopularFilters {
  const left = (Object.keys(CATEGORY_IDS) as PopularInclude[]).filter((key) => !include.includes(key));
  const ids = (pick: (c: (typeof CATEGORY_IDS)[PopularInclude]) => number | undefined, keys: readonly PopularInclude[]) =>
    keys.flatMap((key) => pick(CATEGORY_IDS[key]) ?? []).sort((a, b) => a - b);
  return {
    movieWithoutGenres: ids((c) => c.movieGenre, left),
    tvWithoutGenres: ids((c) => c.tvGenre, left),
    tvTypes: [...BASE_TV_TYPES, ...ids((c) => c.tvType, include)].sort((a, b) => a - b),
  };
}

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
  withoutGenres: readonly number[],
): PopularTile[] {
  // Some lists can't be filtered by TMDB (trending, upcoming movies), so excluded genres are dropped here, for every list.
  return movies
    .filter((m) => !m.genreIds.some((id) => withoutGenres.includes(id)))
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
  withoutGenres: readonly number[],
): PopularTile[] {
  return shows
    .filter((s) => !s.genreIds.some((id) => withoutGenres.includes(id)))
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
 * The services in the order the Popular page ranks them: TMDB's display priority for the country, then name. This is the
 * only place the providers are sorted.
 */
export function rankServices(providers: readonly TmdbProvider[], region: string): TmdbProvider[] {
  // TMDB ranks services per country (display_priorities), and also has one global rank. The country's rank wins.
  const rank = (p: TmdbProvider) => p.displayPriorities[region] ?? p.displayPriority;
  return [...providers].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The movie and TV services as one ranked list. A service in both appears once. */
export function mergeServices(
  movie: readonly TmdbProvider[],
  tv: readonly TmdbProvider[],
  region: string,
): TmdbProvider[] {
  const byId = new Map<number, TmdbProvider>();
  for (const p of [...movie, ...tv]) if (!byId.has(p.id)) byId.set(p.id, p);
  return rankServices([...byId.values()], region);
}

/**
 * The services to offer for one kind (movies or TV) in a country. With no chosen ids: the most prominent SERVICE_LIMIT.
 * With chosen ids: those of them TMDB offers for this kind, in the chosen order.
 */
export function offeredServices(
  providers: readonly TmdbProvider[],
  region: string,
  chosenIds: readonly number[],
): TmdbProvider[] {
  if (chosenIds.length === 0) return rankServices(providers, region).slice(0, SERVICE_LIMIT);
  const byId = new Map(providers.map((p) => [p.id, p]));
  return chosenIds.flatMap((id) => byId.get(id) ?? []);
}

/** The Netflix id, the default service when the country has it and no list is chosen. */
const NETFLIX_ID = 8;

/**
 * The requested service when it is on offer. Otherwise Netflix if offered (only when no list is chosen: a chosen list
 * starts at its first service), else the first. Null when there are none.
 */
export function chooseService(
  services: readonly TmdbProvider[],
  requestedId: number | null,
  preferNetflix = true,
): TmdbProvider | null {
  return (
    services.find((s) => s.id === requestedId) ??
    (preferNetflix ? services.find((s) => s.id === NETFLIX_ID) : undefined) ??
    services[0] ??
    null
  );
}

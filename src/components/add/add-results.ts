// Pure helpers for the Add page: one row shape for movies and series, the interleaving, the kind filter and the
// admin panel's starting values. Client-safe: only type imports from src/server.
import type { LookupResult } from "@/server/arr/movie-add";
import type { SeriesLookupResult } from "@/server/arr/series-add";
import type { SeriesMonitor, SeriesTypeOption } from "@/components/tv/series-add";

/** One row on the Add page. `key` is needed because TMDB and TVDB ids can collide. */
export type AddItem = {
  key: string;
  kind: "movie" | "series";
  /** The TMDB id for a movie, the TVDB id for a series. */
  externalId: number;
  title: string;
  year: number | null;
  /** The TV network. Null for movies and for series with no network. */
  network: string | null;
  overview: string;
  /** A MediaHub poster route, or null when there is no usable poster. */
  posterSrc: string | null;
  inLibrary: boolean;
};

export type AddKind = "all" | "movie" | "series";

/** Movie search hits as rows, in the order Radarr returned them. */
export function movieItems(results: readonly LookupResult[]): AddItem[] {
  return results.map(
    (result): AddItem => ({
      key: `movie-${result.tmdbId}`,
      kind: "movie",
      externalId: result.tmdbId,
      title: result.title,
      year: result.year,
      network: null,
      overview: result.overview,
      posterSrc: result.posterFile === null ? null : `/api/movies/lookup-poster/${result.posterFile}`,
      inLibrary: result.inLibrary,
    }),
  );
}

/** Series search hits as rows, in the order Sonarr returned them. */
export function seriesItems(results: readonly SeriesLookupResult[]): AddItem[] {
  return results.map(
    (result): AddItem => ({
      key: `series-${result.tvdbId}`,
      kind: "series",
      externalId: result.tvdbId,
      title: result.title,
      year: result.year,
      network: result.network,
      overview: result.overview,
      posterSrc: result.posterPath === null ? null : `/api/tv/lookup-poster/${result.posterPath}`,
      inLibrary: result.inLibrary,
    }),
  );
}

/**
 * Movies and series taken in turns (movie 1, series 1, movie 2, ...). When one list is longer, its remaining items
 * follow in their own order. Each list keeps its own order.
 */
export function mergeResults(movies: readonly AddItem[], series: readonly AddItem[]): AddItem[] {
  const merged: AddItem[] = [];
  const longest = Math.max(movies.length, series.length);
  for (let index = 0; index < longest; index += 1) {
    if (index < movies.length) merged.push(movies[index]);
    if (index < series.length) merged.push(series[index]);
  }
  return merged;
}

/** The rows of one kind, or all of them. Order is kept. */
export function filterByKind(items: readonly AddItem[], kind: AddKind): AddItem[] {
  return kind === "all" ? [...items] : items.filter((item) => item.kind === kind);
}

/** The saved default id when it is still in the list, otherwise the first item's id, otherwise null. */
export function initialId(options: readonly { id: number }[], defaultId: number | null): number | null {
  if (defaultId !== null && options.some((option) => option.id === defaultId)) return defaultId;
  return options[0]?.id ?? null;
}

/** An admin's Add options for one app, as the Add page sends them. Only ids, names, paths and saved defaults. */
export type AddOptionsForApp<Defaults> = {
  profiles: { id: number; name: string }[];
  folders: { id: number; path: string }[];
  defaults: Defaults;
};

export type MovieFormDefaults = { profileId: number | null; rootFolderId: number | null };
export type SeriesFormDefaults = MovieFormDefaults & { monitor: SeriesMonitor | null };

/** The movie panel's fields. Profile and folder start on the saved defaults. Monitored and search start on. */
export type MovieForm = { profileId: number | null; rootFolderId: number | null; monitored: boolean; searchForMovie: boolean };

/** The series panel's fields. Monitor starts on the saved monitor (or "all"), type "standard", season folders and search on. */
export type SeriesForm = {
  profileId: number | null;
  rootFolderId: number | null;
  monitor: SeriesMonitor;
  seriesType: SeriesTypeOption;
  seasonFolder: boolean;
  searchForMissingEpisodes: boolean;
};

export function movieFormFor(options: AddOptionsForApp<MovieFormDefaults>): MovieForm {
  return {
    profileId: initialId(options.profiles, options.defaults.profileId),
    rootFolderId: initialId(options.folders, options.defaults.rootFolderId),
    monitored: true,
    searchForMovie: true,
  };
}

export function seriesFormFor(options: AddOptionsForApp<SeriesFormDefaults>): SeriesForm {
  return {
    profileId: initialId(options.profiles, options.defaults.profileId),
    rootFolderId: initialId(options.folders, options.defaults.rootFolderId),
    monitor: options.defaults.monitor ?? "all",
    seriesType: "standard",
    seasonFolder: true,
    searchForMissingEpisodes: true,
  };
}

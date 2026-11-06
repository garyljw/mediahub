import "server-only";

import { lookupMovies, type LookupResult } from "@/server/arr/movie-add";
import { lookupSeries, type SeriesLookupResult } from "@/server/arr/series-add";
import { ArrRequestError } from "@/server/arr/request";
import { TitleSearchError, type TitleHit, type TitleSearchProvider } from "./types";

/** Pure: Radarr search hits to title hits, in upstream order. The poster route is the same one the Add page uses. */
export function movieHits(results: readonly LookupResult[]): TitleHit[] {
  return results.map((result) => ({
    externalId: result.tmdbId,
    title: result.title,
    year: result.year,
    network: null,
    overview: result.overview,
    posterSrc: result.posterFile === null ? null : `/api/movies/lookup-poster/${result.posterFile}`,
    inLibrary: result.inLibrary,
  }));
}

/** Pure: Sonarr search hits to title hits, in upstream order. The poster route is the same one the Add page uses. */
export function seriesHits(results: readonly SeriesLookupResult[]): TitleHit[] {
  return results.map((result) => ({
    externalId: result.tvdbId,
    title: result.title,
    year: result.year,
    network: result.network,
    overview: result.overview,
    posterSrc: result.posterPath === null ? null : `/api/tv/lookup-poster/${result.posterPath}`,
    inLibrary: result.inLibrary,
  }));
}

/**
 * Turns a failed Arr request into a TitleSearchError with a safe message. Anything else is rethrown. ArrRequestError
 * messages never contain the host, key or response body, so they are safe to log.
 */
function failedSearch(error: unknown, message: string): never {
  if (!(error instanceof ArrRequestError)) throw error;
  console.error(`Title search: ${error.message}`);
  throw new TitleSearchError(message);
}

/** The title search through Radarr (movies, TMDB ids) and Sonarr (series, TVDB ids). */
export const arrTitleSearch: TitleSearchProvider = {
  async search(kind, term) {
    if (kind === "movie") {
      try {
        return movieHits(await lookupMovies(term));
      } catch (error) {
        return failedSearch(error, "Radarr couldn't complete the search");
      }
    }
    try {
      return seriesHits(await lookupSeries(term));
    } catch (error) {
      return failedSearch(error, "Sonarr couldn't complete the search");
    }
  },
};

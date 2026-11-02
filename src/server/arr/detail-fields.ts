import "server-only";

// Field checks shared by the movie and series page mappers (movie-detail.ts, series-detail.ts), so both apply the
// same rules to Radarr's and Sonarr's optional fields.

/** Most genres shown on an item page. Radarr and Sonarr can send more; the header only has room for a few. */
const MAX_GENRES = 5;

const IMDB_ID = /^tt\d{1,10}$/;

/** Non-empty text, or null. Used for optional upstream strings. */
export function textOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A rating's value, only when it has votes behind it and the value is positive. */
export function ratingValue(rating: { votes?: number; value?: number } | undefined): number | null {
  if (!rating || typeof rating.votes !== "number" || !(rating.votes > 0)) return null;
  if (typeof rating.value !== "number" || !(rating.value > 0)) return null;
  return rating.value;
}

/** Up to MAX_GENRES non-empty genres, in the upstream order. */
export function genreList(genres: string[] | null | undefined): string[] {
  return (genres ?? []).filter((genre): genre is string => typeof genre === "string" && genre.trim() !== "").slice(0, MAX_GENRES);
}

/** The IMDb id (e.g. "tt0000001") when it has the expected shape, otherwise null. */
export function imdbIdOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && IMDB_ID.test(value) ? value : null;
}

/** A positive integer id (TMDB, TVDB), otherwise null. */
export function positiveIdOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

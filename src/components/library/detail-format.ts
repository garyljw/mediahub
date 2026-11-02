// Text for the movie and series page headers, built from already-mapped values. Pure, so it can be tested without a DOM.
// No Intl here: the server and the browser must print the same text (see components/library/format.ts).
import { formatRuntime } from "@/components/library/format";

/** "IMDb 7.1 · TMDB 68%", with each part left out when its rating is missing. Null when both are missing. */
export function ratingsLine(ratings: { imdb: number | null; tmdb: number | null }): string | null {
  const parts: string[] = [];
  if (ratings.imdb !== null) parts.push(`IMDb ${ratings.imdb.toFixed(1)}`);
  if (ratings.tmdb !== null) parts.push(`TMDB ${Math.round(ratings.tmdb * 10)}%`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "Rating 8.4" for a series' rating, or null when there is none. */
export function seriesRatingLine(rating: number | null): string | null {
  return rating === null ? null : `Rating ${rating.toFixed(1)}`;
}

/** "PG-13 · 2h 5m · Drama, Thriller". Each part is left out when it is missing. Null when none are there. */
export function metaLine({
  certification,
  runtime,
  genres,
}: {
  certification: string | null;
  runtime: number | null;
  genres: string[];
}): string | null {
  const parts = [
    certification,
    formatRuntime(runtime),
    genres.length > 0 ? genres.join(", ") : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "Directed by A, B", or null when there are no directors. */
export function directorsLine(directors: string[]): string | null {
  return directors.length > 0 ? `Directed by ${directors.join(", ")}` : null;
}

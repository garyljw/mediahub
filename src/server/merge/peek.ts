import "server-only";

/** The most genres a hover card shows. */
const MAX_GENRES = 3;
/** Longest overview sent to the browser, in code points (so an emoji is never cut in half). Longer text is cut and ends with an ellipsis. */
export const MAX_OVERVIEW = 300;

/** What a hover card shows about a title, beside its poster. Plain text only. */
export type Peek = { year: number | null; genres: string[]; overview: string };

/** The fields of a Radarr MovieResource or Sonarr SeriesResource that a Peek reads. */
type PeekSource = { year?: number | null; genres?: string[] | null; overview?: string | null };

/**
 * Cuts text to MAX_OVERVIEW code points, ending a cut with an ellipsis. Text at or under the limit comes back
 * unchanged, and null or undefined comes back as "". Array.from splits by code point, so a cut never splits a
 * surrogate pair.
 */
export function cutOverview(text: string | null | undefined): string {
  const chars = Array.from(text ?? "");
  return chars.length > MAX_OVERVIEW ? `${chars.slice(0, MAX_OVERVIEW - 1).join("")}…` : chars.join("");
}

/**
 * Pure: the hover-card facts of one movie or series resource, or null when the resource is missing or has nothing
 * worth a card (no year, no genres and no overview). A year must be a positive integer. Genres keep the first three
 * non-empty strings, trimmed. The overview is trimmed, then cut by cutOverview.
 */
export function toPeek(resource: PeekSource | null | undefined): Peek | null {
  if (!resource) return null;
  const year = typeof resource.year === "number" && Number.isInteger(resource.year) && resource.year > 0 ? resource.year : null;
  const genres = Array.isArray(resource.genres)
    ? resource.genres
        .filter((genre): genre is string => typeof genre === "string")
        .map((genre) => genre.trim())
        .filter((genre) => genre !== "")
        .slice(0, MAX_GENRES)
    : [];
  const overview = cutOverview(typeof resource.overview === "string" ? resource.overview.trim() : "");
  if (year === null && genres.length === 0 && overview === "") return null;
  return { year, genres, overview };
}

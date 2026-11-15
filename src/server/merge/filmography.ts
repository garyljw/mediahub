import "server-only";
import { yearOf } from "./popular";
import type { TmdbPersonCredit } from "@/server/tmdb/schemas";

// A person's acting credits as the person page shows them: filtered, de-duplicated, newest first, each linked to its
// page. Pure, so it is tested with a JSON fixture.

export type FilmographyTile = {
  key: string;
  kind: "movie" | "tv";
  tmdbId: number;
  title: string;
  year: number | null;
  character: string | null;
  episodes: number | null;
  posterFile: string | null;
  href: string;
  inLibrary: boolean;
};

/** `tiles` is movies and shows together, newest first. The page filters it by `kind` for its Movies and TV views. */
export type Filmography = { tiles: FilmographyTile[]; backdropFile: string | null };

/** "Self", "Himself", "Herself - Guest", "Themselves": the person playing themselves, not a role. */
const SELF_ROLE = /^(self|himself|herself|themselves)\b/i;
/**
 * TV genres left out of a person's filmography: News, Reality and Talk. Unlike the Popular page's EXCLUDED_TV_GENRES,
 * documentaries and soaps are kept, because actors act in them.
 */
const PERSON_EXCLUDED_TV_GENRES: readonly number[] = [10763, 10764, 10767];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Merged = {
  kind: "movie" | "tv";
  tmdbId: number;
  title: string;
  date: string | null;
  characters: string[];
  episodes: number | null;
  posterFile: string | null;
  backdropFile: string | null;
};

function isKept(credit: TmdbPersonCredit): boolean {
  if (credit.adult) return false;
  if (credit.character !== null && SELF_ROLE.test(credit.character.trim())) return false;
  if (credit.kind === "tv" && credit.genreIds.some((id) => PERSON_EXCLUDED_TV_GENRES.includes(id))) return false;
  return true;
}

/** Newest first, undated last, then by title. Dates are YYYY-MM-DD, so a string compare orders them. */
function byNewest(a: { date: string | null; title: string }, b: { date: string | null; title: string }): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? 1 : -1;
  }
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

function mergeCredits(credits: TmdbPersonCredit[]): Merged[] {
  const merged = new Map<string, Merged>();
  for (const credit of credits.filter(isKept)) {
    const key = `${credit.kind}-${credit.tmdbId}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        kind: credit.kind,
        tmdbId: credit.tmdbId,
        title: credit.title,
        date: credit.date,
        characters: credit.character === null ? [] : [credit.character],
        episodes: credit.episodes,
        posterFile: credit.posterFile,
        backdropFile: credit.backdropFile,
      });
      continue;
    }
    if (credit.character !== null && !existing.characters.includes(credit.character)) existing.characters.push(credit.character);
    if (credit.episodes !== null && (existing.episodes === null || credit.episodes > existing.episodes)) existing.episodes = credit.episodes;
    existing.date ??= credit.date;
    existing.posterFile ??= credit.posterFile;
    existing.backdropFile ??= credit.backdropFile;
  }
  return [...merged.values()];
}

/**
 * The person's movies and shows, and the backdrop for the page header. `library` maps a TMDB id to the Radarr or Sonarr
 * id; null means the library couldn't be read, so every tile links to the preview page (which redirects a library title
 * to its own page). `today` is YYYY-MM-DD.
 */
export function toFilmography(
  credits: TmdbPersonCredit[],
  library: { movies: Map<number, number> | null; series: Map<number, number> | null },
  today: string,
): Filmography {
  const items = mergeCredits(credits).sort(byNewest);

  const tile = (item: Merged): FilmographyTile => {
    const libraryId = (item.kind === "movie" ? library.movies : library.series)?.get(item.tmdbId);
    const inLibrary = libraryId !== undefined;
    const base = item.kind === "movie" ? "movies" : "tv";
    return {
      key: `${item.kind}-${item.tmdbId}`,
      kind: item.kind,
      tmdbId: item.tmdbId,
      title: item.title,
      year: yearOf(item.date),
      character: item.characters.length === 0 ? null : item.characters.join(" / "),
      episodes: item.episodes,
      posterFile: item.posterFile,
      href: inLibrary ? `/${base}/${libraryId}` : `/popular/${item.kind}/${item.tmdbId}`,
      inLibrary,
    };
  };

  // Items are already newest first, so the first match is the newest. A credit dated after today hasn't been released.
  const withBackdrop = items.filter((item) => item.backdropFile !== null);
  const released = withBackdrop.find((item) => item.date !== null && item.date <= today);
  const backdropFile = (released ?? withBackdrop[0])?.backdropFile ?? null;

  return { tiles: items.map(tile), backdropFile };
}

/** Whole years from `birthday` to `on` (both YYYY-MM-DD), or null for bad input or a birthday after `on`. */
export function ageOn(birthday: string, on: string): number | null {
  if (!DATE.test(birthday) || !DATE.test(on)) return null;
  const [by, bm, bd] = birthday.split("-").map(Number);
  const [oy, om, od] = on.split("-").map(Number);
  if (bm < 1 || bm > 12 || bd < 1 || bd > 31 || om < 1 || om > 12 || od < 1 || od > 31) return null;
  const age = oy - by - (om < bm || (om === bm && od < bd) ? 1 : 0);
  return age >= 0 ? age : null;
}

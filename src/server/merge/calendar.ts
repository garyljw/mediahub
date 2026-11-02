import "server-only";
import type { components as RadarrComponents } from "../arr/generated/radarr";
import type { components as SonarrComponents } from "../arr/generated/sonarr";
import { episodeCode } from "@/components/library/release";
import { TITLE_COLLATOR } from "@/components/library/list";
import { episodeStatus } from "./episode-status";
import { isCalendarDate, utcDateOf } from "./calendar-dates";
import { hasPoster } from "./images";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];
type EpisodeResource = SonarrComponents["schemas"]["EpisodeResource"];

/**
 * "notAvailable" is a movie release date that has passed while Radarr's isAvailable flag is still false. "upcoming"
 * is a date still ahead (a movie release) or an episode that hasn't aired.
 */
export type CalendarStatus = "downloaded" | "missing" | "upcoming" | "notAvailable" | "unmonitored";
export type ReleaseType = "cinema" | "digital" | "physical";

/** One line on the calendar. Only these fields leave the server: no paths, overviews, file info or upstream URLs. */
export type CalendarEntry = {
  /** Unique within the list: `movie-${id}-${releaseType}` or `episode-${id}`. */
  key: string;
  /** "YYYY-MM-DD". */
  date: string;
  kind: "movie" | "episode";
  /** The movie title, or the series title. */
  title: string;
  /** Movie: "In cinemas" | "Digital release" | "Physical release". Episode: "S02E05 · Title". */
  detail: string;
  /** The short form for a grid chip. Movie: "Cinema" | "Digital" | "Physical". Episode: "S02E05". */
  shortDetail: string;
  /** Null for episodes. */
  releaseType: ReleaseType | null;
  status: CalendarStatus;
  /** MediaHub's own poster route, only when the item has a poster. */
  posterSrc: string | null;
  /** Episodes link to their series page. Movies have no page, so null. */
  href: string | null;
};

const RELEASE_SHORT_LABELS: Record<ReleaseType, string> = {
  cinema: "Cinema",
  digital: "Digital",
  physical: "Physical",
};

const RELEASE_LABELS: Record<ReleaseType, string> = {
  cinema: "In cinemas",
  digital: "Digital release",
  physical: "Physical release",
};

/** The calendar date part of a Radarr release date, or null. Radarr sends a full timestamp, so only the date is kept. */
function releaseDateOf(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10);
  return isCalendarDate(day) ? day : null;
}

/** An entry plus the key it sorts by within a day (Radarr's or Sonarr's sortTitle). The key never leaves the server. */
type Sortable = { entry: CalendarEntry; sortKey: string };

/**
 * Status of one movie release date. Worked out per date, not per movie: a movie's cinema date can have passed
 * while its physical date is still ahead.
 */
function movieStatus(movie: MovieResource, date: string, today: string): CalendarStatus {
  if (movie.hasFile === true) return "downloaded";
  if (movie.monitored !== true) return "unmonitored";
  if (date > today) return "upcoming";
  return movie.isAvailable === true ? "missing" : "notAvailable";
}

/** Movie entries: one per release date that falls in the range. A movie with two such dates gives two entries. */
function movieEntries(movie: MovieResource, from: string, to: string, today: string): Sortable[] {
  if (typeof movie.id !== "number" || !movie.title) return [];

  const dates: [ReleaseType, string | null | undefined][] = [
    ["cinema", movie.inCinemas],
    ["digital", movie.digitalRelease],
    ["physical", movie.physicalRelease],
  ];
  const posterSrc = hasPoster(movie.images) ? `/api/movies/${movie.id}/poster` : null;
  const sortKey = (movie.sortTitle || movie.title).toLowerCase();

  const entries: Sortable[] = [];
  for (const [releaseType, value] of dates) {
    const date = releaseDateOf(value);
    if (date === null || date < from || date > to) continue;
    entries.push({
      entry: {
        key: `movie-${movie.id}-${releaseType}`,
        date,
        kind: "movie",
        title: movie.title,
        detail: RELEASE_LABELS[releaseType],
        shortDetail: RELEASE_SHORT_LABELS[releaseType],
        releaseType,
        status: movieStatus(movie, date, today),
        posterSrc,
        href: null,
      },
      sortKey,
    });
  }
  return entries;
}

/**
 * Episode entry, or null when it is skipped. Sonarr is asked for a wider window than the page shows (a day
 * either side, because airDate and airDateUtc can differ), so anything outside [from, to] is dropped here.
 */
function episodeEntry(
  episode: EpisodeResource,
  from: string,
  to: string,
  now: number,
): Sortable | null {
  const series = episode.series;
  if (
    typeof episode.id !== "number" ||
    typeof episode.seriesId !== "number" ||
    typeof episode.seasonNumber !== "number" ||
    typeof episode.episodeNumber !== "number" ||
    !series?.title
  ) {
    return null;
  }

  // The local air date, not airDateUtc: a late US airing is already the next day in UTC.
  const date = typeof episode.airDate === "string" && isCalendarDate(episode.airDate) ? episode.airDate : null;
  if (date === null || date < from || date > to) return null;

  // Same rule as the series page: the series, the season and the episode must all be monitored. A season that
  // Sonarr doesn't list counts as unmonitored.
  const season = series.seasons?.find((candidate) => candidate.seasonNumber === episode.seasonNumber);
  const wanted = series.monitored === true && episode.monitored === true && season?.monitored === true;
  const status = episodeStatus(episode, wanted, now);
  const code = episodeCode(episode.seasonNumber, episode.episodeNumber);

  return {
    entry: {
      key: `episode-${episode.id}`,
      date,
      kind: "episode",
      title: series.title,
      detail: `${code} · ${episode.title || "TBA"}`,
      shortDetail: code,
      releaseType: null,
      // The series page calls a not-yet-aired episode "unaired". The calendar uses "upcoming" for both kinds.
      status: status === "unaired" ? "upcoming" : status,
      posterSrc: hasPoster(series.images) ? `/api/tv/${episode.seriesId}/poster` : null,
      href: `/tv/${episode.seriesId}`,
    },
    sortKey: (series.sortTitle || series.title).toLowerCase(),
  };
}

/**
 * Pure: merges Radarr movie releases and Sonarr episodes into one list for the calendar, for the range from..to
 * (both "YYYY-MM-DD", inclusive). Skips malformed items. Sorted by date, then movies before episodes, then sort
 * title (as the library tables sort), then detail.
 */
export function toCalendarEntries(
  movies: MovieResource[],
  episodes: EpisodeResource[],
  from: string,
  to: string,
  now: number,
): CalendarEntry[] {
  const today = utcDateOf(now);
  const items: Sortable[] = [];

  for (const movie of movies) {
    items.push(...movieEntries(movie, from, to, today));
  }

  for (const episode of episodes) {
    const item = episodeEntry(episode, from, to, now);
    if (item !== null) items.push(item);
  }

  // The tables' collator, so titles order the same way here ("2 Guns" before "10 Cloverfield Lane"), and E99
  // before E100. This runs only on the server, so Intl can't cause a hydration mismatch.
  items.sort((a, b) => {
    if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? -1 : 1;
    if (a.entry.kind !== b.entry.kind) return a.entry.kind === "movie" ? -1 : 1;
    return TITLE_COLLATOR.compare(a.sortKey, b.sortKey) || TITLE_COLLATOR.compare(a.entry.detail, b.entry.detail);
  });
  return items.map((item) => item.entry);
}

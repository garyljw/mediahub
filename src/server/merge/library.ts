import "server-only";
import type { MovieRow } from "@/server/arr/movies";
import type { SeriesRow } from "@/server/arr/series";
import { compareHomeItems, type HomeDownloadDate, type HomeItem, type HomeWatched } from "@/components/home/home-items";
import { formatCount } from "@/components/library/format";
import { STATUS_CLASS as MOVIE_STATUS_CLASS, STATUS_LABEL as MOVIE_STATUS_LABEL } from "@/components/movies/movie-status";
import { EPISODE_STATUS_CLASS } from "@/components/tv/series-status";
import type { FocusMembership } from "@/server/focus/focus";
import type { PlexAddedIndex } from "./plex-added";
import type { WatchedIndex, WatchedState } from "./watched";

function movieItem(row: MovieRow, watched: WatchedIndex | null, inFocus: boolean): HomeItem {
  return {
    key: `movie:${row.id}`,
    kind: "movie",
    id: row.id,
    title: row.title,
    year: row.year,
    sortTitle: row.sortTitle,
    released: row.releaseDate,
    latest: row.latestReleaseDate,
    sizeOnDisk: row.sizeOnDisk,
    downloaded: null,
    href: `/movies/${row.id}`,
    posterSrc: row.hasPoster ? `/api/movies/${row.id}/poster` : null,
    badge: { label: MOVIE_STATUS_LABEL[row.status], className: MOVIE_STATUS_CLASS[row.status] },
    onDisk: row.status === "downloaded",
    watched: row.tmdbId === null ? null : (watched?.movies.get(row.tmdbId) ?? null),
    inFocus,
  };
}

/**
 * The same "have / want" episode figure as the series page. Green when nothing is missing, amber when episodes are
 * missing, muted when Sonarr expects none.
 */
function seriesBadge(row: SeriesRow): HomeItem["badge"] {
  const className =
    row.episodeCount === 0
      ? EPISODE_STATUS_CLASS.unaired
      : row.episodeFileCount >= row.episodeCount
        ? EPISODE_STATUS_CLASS.downloaded
        : EPISODE_STATUS_CLASS.missing;
  return { label: `${formatCount(row.episodeFileCount)}/${formatCount(row.episodeCount)} episodes`, className };
}

function seriesItem(row: SeriesRow, watched: WatchedIndex | null, inFocus: boolean): HomeItem {
  return {
    key: `series:${row.id}`,
    kind: "series",
    id: row.id,
    title: row.title,
    year: row.year,
    sortTitle: row.sortTitle,
    released: row.firstAired,
    latest: row.latestAired,
    sizeOnDisk: row.sizeOnDisk,
    // Filled in by the page's download-date stream (see homeDownloadedByKey), so it starts null here.
    downloaded: null,
    href: `/tv/${row.id}`,
    posterSrc: row.hasPoster ? `/api/tv/${row.id}/poster` : null,
    badge: seriesBadge(row),
    onDisk: row.episodeFileCount > 0,
    watched: row.tvdbId === null ? null : (watched?.series.get(row.tvdbId) ?? null),
    inFocus,
  };
}

/**
 * Pure: merges the Movies and TV rows into Home grid items, A–Z by sort title (see compareHomeItems). Each item gets
 * its Plex watched state from the index, matched by TMDB id (movies) and TVDB id (series). No index, or no match, gives null.
 */
export function toHomeItems(
  movies: MovieRow[],
  series: SeriesRow[],
  watched: WatchedIndex | null,
  focus: FocusMembership = { movie: new Set(), series: new Set() },
): HomeItem[] {
  return [
    ...movies.map((row) => movieItem(row, watched, focus.movie.has(row.id))),
    ...series.map((row) => seriesItem(row, watched, focus.series.has(row.id))),
  ].sort(compareHomeItems);
}

/**
 * Pure: the watched state for each Home item that Plex matched, keyed like toHomeItems (`movie:id`, `series:id`).
 * Rows with no match are left out, so the map is small and holds no Plex detail beyond the state.
 */
export function homeWatchedByKey(
  movies: MovieRow[],
  series: SeriesRow[],
  watched: WatchedIndex,
): Record<string, WatchedState> {
  const byKey: Record<string, WatchedState> = {};
  for (const row of movies) {
    const state = row.tmdbId === null ? undefined : watched.movies.get(row.tmdbId);
    if (state !== undefined) byKey[`movie:${row.id}`] = state;
  }
  for (const row of series) {
    const state = row.tvdbId === null ? undefined : watched.series.get(row.tvdbId);
    if (state !== undefined) byKey[`series:${row.id}`] = state;
  }
  return byKey;
}

/** The later of two ISO dates, or whichever one is there. */
function laterOf(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Pure: the download date for each title that has a file, keyed like toHomeItems (`movie:id`, `series:id`). A title's date
 * is the later of its newest import in Radarr's or Sonarr's history (an upgrade is an import) and the day it arrived in
 * Plex, recorded. With neither, a movie uses its file record's date and a series uses `seriesFileDates` (recorded false).
 * A title with no file gets no entry. An import map or a Plex index that "failed", or a null Plex index, counts as empty.
 */
export function homeDownloadedByKey(
  movies: MovieRow[],
  series: SeriesRow[],
  movieImports: Map<number, string> | "failed",
  seriesImports: Map<number, string> | "failed",
  plex: PlexAddedIndex | null | "failed",
  seriesFileDates: Map<number, string | null>,
): Record<string, HomeDownloadDate> {
  const movieImported = movieImports === "failed" ? new Map<number, string>() : movieImports;
  const seriesImported = seriesImports === "failed" ? new Map<number, string>() : seriesImports;
  const plexMovies = plex === null || plex === "failed" ? new Map<number, string>() : plex.movies;
  const plexSeries = plex === null || plex === "failed" ? new Map<number, string>() : plex.series;
  const byKey: Record<string, HomeDownloadDate> = {};

  for (const row of movies) {
    if (row.status !== "downloaded") continue;
    const latest = laterOf(movieImported.get(row.id), row.tmdbId === null ? undefined : plexMovies.get(row.tmdbId));
    if (latest !== undefined) byKey[`movie:${row.id}`] = { at: latest, recorded: true };
    else if (row.fileAddedAt !== null) byKey[`movie:${row.id}`] = { at: row.fileAddedAt, recorded: false };
  }

  for (const row of series) {
    if (row.episodeFileCount === 0) continue;
    const latest = laterOf(seriesImported.get(row.id), row.tvdbId === null ? undefined : plexSeries.get(row.tvdbId));
    if (latest !== undefined) {
      byKey[`series:${row.id}`] = { at: latest, recorded: true };
      continue;
    }
    const fileDate = seriesFileDates.get(row.id);
    if (fileDate) byKey[`series:${row.id}`] = { at: fileDate, recorded: false };
  }

  return byKey;
}

/**
 * Pure: the Plex part of the Home grid's data, from the rows that loaded and the watched index. "failed" when Plex
 * couldn't be read, "none" when no Plex data connection is set up, otherwise the state per matched item.
 */
export function homeWatched(
  movies: MovieRow[],
  series: SeriesRow[],
  index: WatchedIndex | null | "failed",
): HomeWatched {
  if (index === "failed") return { state: "failed" };
  if (index === null) return { state: "none" };
  return { state: "ready", byKey: homeWatchedByKey(movies, series, index) };
}

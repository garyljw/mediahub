import "server-only";
import type { MovieRow } from "@/server/arr/movies";
import type { SeriesRow } from "@/server/arr/series";
import { compareHomeItems, type HomeItem, type HomeWatched } from "@/components/home/home-items";
import { formatCount } from "@/components/library/format";
import { STATUS_CLASS as MOVIE_STATUS_CLASS, STATUS_LABEL as MOVIE_STATUS_LABEL } from "@/components/movies/movie-status";
import { EPISODE_STATUS_CLASS } from "@/components/tv/series-status";
import type { FocusMembership } from "@/server/focus/focus";
import type { WatchedIndex, WatchedState } from "./watched";

function movieItem(row: MovieRow, watched: WatchedIndex | null, inFocus: boolean): HomeItem {
  return {
    key: `movie:${row.id}`,
    kind: "movie",
    id: row.id,
    title: row.title,
    year: row.year,
    sortTitle: row.sortTitle,
    added: row.added,
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
    added: row.added,
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

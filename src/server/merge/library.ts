import "server-only";
import type { MovieRow } from "@/server/arr/movies";
import type { SeriesRow } from "@/server/arr/series";
import { compareHomeItems, type HomeItem } from "@/components/home/home-items";
import { formatCount } from "@/components/library/format";
import { STATUS_CLASS as MOVIE_STATUS_CLASS, STATUS_LABEL as MOVIE_STATUS_LABEL } from "@/components/movies/movie-status";
import { EPISODE_STATUS_CLASS } from "@/components/tv/series-status";

function movieItem(row: MovieRow): HomeItem {
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
  };
}

/**
 * The same "have / want" episode figure as the TV table. Green when nothing is missing, amber when episodes are
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

function seriesItem(row: SeriesRow): HomeItem {
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
  };
}

/**
 * Pure: merges the Movies and TV rows into Home grid items, A–Z by sort title (see compareHomeItems).
 */
export function toHomeItems(movies: MovieRow[], series: SeriesRow[]): HomeItem[] {
  return [...movies.map(movieItem), ...series.map(seriesItem)].sort(compareHomeItems);
}

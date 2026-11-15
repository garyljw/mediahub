import "server-only";
import { toEpisodeWatched } from "@/server/merge/watched";
import { getSeriesEpisodeWatched } from "./watched";
import type { WatchedState } from "@/components/home/home-items";
import type { SeriesDetail } from "@/server/arr/series-detail";

/**
 * Each episode's Plex watched state. Null when there is no Plex connection, no TVDB id, or Plex doesn't list the
 * series (no column, no message). "failed" when Plex can't be read, which shows a status line instead.
 */
export async function episodeWatchedFor(detail: SeriesDetail): Promise<Map<number, WatchedState> | null | "failed"> {
  if (detail.tvdbId === null) return null;
  const plexEpisodes = await getSeriesEpisodeWatched(detail.tvdbId);
  if (plexEpisodes === null || plexEpisodes === "failed") return plexEpisodes;
  const episodes = detail.seasons.flatMap((season) =>
    season.episodes.map((episode) => ({
      id: episode.id,
      tvdbId: episode.tvdbId,
      seasonNumber: season.seasonNumber,
      episodeNumber: episode.episodeNumber,
    })),
  );
  return toEpisodeWatched(episodes, plexEpisodes);
}

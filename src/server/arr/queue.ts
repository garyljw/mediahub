import "server-only";
import { radarrClient, sonarrClient } from "./client";
import { getList } from "./request";
import type { components as RadarrComponents } from "./generated/radarr";
import type { components as SonarrComponents } from "./generated/sonarr";

export type MovieQueueItem = RadarrComponents["schemas"]["QueueResource"];
export type EpisodeQueueItem = SonarrComponents["schemas"]["QueueResource"];

/**
 * The only place that calls Radarr's and Sonarr's /api/v3/queue/details. The include flags say which nested objects to
 * ask for. Callers pass them explicitly, so each one states what it reads.
 */
export async function fetchMovieQueue({ includeMovie }: { includeMovie: boolean }): Promise<MovieQueueItem[]> {
  const client = radarrClient();
  return getList("Radarr queue", (signal) =>
    client.GET("/api/v3/queue/details", { params: { query: { includeMovie } }, signal }),
  );
}

/** Sonarr's queue details. `seriesId`, when given, limits the queue to one series. */
export async function fetchEpisodeQueue({
  includeSeries,
  includeEpisode,
  seriesId,
}: {
  includeSeries: boolean;
  includeEpisode: boolean;
  seriesId?: number;
}): Promise<EpisodeQueueItem[]> {
  const client = sonarrClient();
  return getList("Sonarr queue", (signal) =>
    client.GET("/api/v3/queue/details", {
      params: { query: { seriesId, includeSeries, includeEpisode } },
      signal,
    }),
  );
}

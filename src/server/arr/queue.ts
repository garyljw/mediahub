import "server-only";
import { radarrClient, sonarrClient } from "./client";
import { DELETE_TIMEOUT_MS, arrRequest, getList } from "./request";
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

/**
 * What to do with the downloads when they are removed. removeFromClient deletes the download and its data from the
 * download client. blocklist marks the release as failed and adds it to the blocklist. skipRedownload asks the app not
 * to search for a replacement afterwards.
 */
export type RemoveOptions = { removeFromClient: boolean; blocklist: boolean; skipRedownload: boolean };

/**
 * Builds the bulk-remove query. changeCategory is always false. skipRedownload is sent as blocklist && skipRedownload,
 * so it is false unless the release is also blocklisted.
 */
function removeQuery({ removeFromClient, blocklist, skipRedownload }: RemoveOptions) {
  return {
    removeFromClient,
    blocklist,
    skipRedownload: blocklist && skipRedownload,
    changeCategory: false,
  };
}

/** Removes the given Radarr queue items. Upstream de-duplicates by download, so one download is removed once. */
export async function removeMovieQueueItems(ids: number[], opts: RemoveOptions): Promise<void> {
  const client = radarrClient();
  const body: RadarrComponents["schemas"]["QueueBulkResource"] = { ids };
  await arrRequest(
    "Radarr queue remove",
    (signal) => client.DELETE("/api/v3/queue/bulk", { params: { query: removeQuery(opts) }, body, signal }),
    { timeoutMs: DELETE_TIMEOUT_MS },
  );
}

/** Removes the given Sonarr queue items. Upstream de-duplicates by download, so one download is removed once. */
export async function removeEpisodeQueueItems(ids: number[], opts: RemoveOptions): Promise<void> {
  const client = sonarrClient();
  const body: SonarrComponents["schemas"]["QueueBulkResource"] = { ids };
  await arrRequest(
    "Sonarr queue remove",
    (signal) => client.DELETE("/api/v3/queue/bulk", { params: { query: removeQuery(opts) }, body, signal }),
    { timeoutMs: DELETE_TIMEOUT_MS },
  );
}

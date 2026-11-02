import "server-only";
import { radarrClient, sonarrClient } from "./client";
import { ArrRequestError, arrRequest } from "./request";
import type { components as RadarrComponents } from "./generated/radarr";
import type { components as SonarrComponents } from "./generated/sonarr";

export type MovieHistoryRecord = RadarrComponents["schemas"]["HistoryResource"];
export type EpisodeHistoryRecord = SonarrComponents["schemas"]["HistoryResource"];
export type HistoryPage<T> = { totalRecords: number; records: T[] };

/**
 * Checks the history reply has a record list and a count, and that the count is a number. Anything else is an
 * invalid reply, not an empty history.
 */
function checkPage<T>(label: string, data: unknown): HistoryPage<T> {
  const page = data as { totalRecords?: unknown; records?: unknown } | undefined;
  if (!page || typeof page !== "object" || !Array.isArray(page.records) || typeof page.totalRecords !== "number") {
    throw new ArrRequestError(`${label} response was not a history page`, "invalid");
  }
  return { totalRecords: page.totalRecords, records: page.records as T[] };
}

/**
 * The newest `limit` Radarr history records, newest first. `eventTypes` are Radarr's integer event codes; an empty
 * list means no event filter. Asks Radarr to include the movie on each record.
 */
export async function fetchMovieHistory(limit: number, eventTypes: number[]): Promise<HistoryPage<MovieHistoryRecord>> {
  const client = radarrClient();
  const data = await arrRequest("Radarr history", (signal) =>
    client.GET("/api/v3/history", {
      params: {
        query: {
          page: 1,
          pageSize: limit,
          sortKey: "date",
          sortDirection: "descending",
          includeMovie: true,
          ...(eventTypes.length > 0 ? { eventType: eventTypes } : {}),
        },
      },
      signal,
    }),
  );
  return checkPage<MovieHistoryRecord>("Radarr history", data);
}

/**
 * The newest `limit` Sonarr history records, newest first. `eventTypes` are Sonarr's integer event codes; an empty
 * list means no event filter. Asks Sonarr to include the series and episode on each record.
 */
export async function fetchEpisodeHistory(limit: number, eventTypes: number[]): Promise<HistoryPage<EpisodeHistoryRecord>> {
  const client = sonarrClient();
  const data = await arrRequest("Sonarr history", (signal) =>
    client.GET("/api/v3/history", {
      params: {
        query: {
          page: 1,
          pageSize: limit,
          sortKey: "date",
          sortDirection: "descending",
          includeSeries: true,
          includeEpisode: true,
          ...(eventTypes.length > 0 ? { eventType: eventTypes } : {}),
        },
      },
      signal,
    }),
  );
  return checkPage<EpisodeHistoryRecord>("Sonarr history", data);
}

/** Sends Radarr's mark-as-failed request for one history item. */
export async function markMovieHistoryFailed(id: number): Promise<void> {
  const client = radarrClient();
  await arrRequest("Radarr mark failed", (signal) =>
    client.POST("/api/v3/history/failed/{id}", { params: { path: { id } }, signal }),
  );
}

/** Sends Sonarr's mark-as-failed request for one history item. */
export async function markEpisodeHistoryFailed(id: number): Promise<void> {
  const client = sonarrClient();
  await arrRequest("Sonarr mark failed", (signal) =>
    client.POST("/api/v3/history/failed/{id}", { params: { path: { id } }, signal }),
  );
}

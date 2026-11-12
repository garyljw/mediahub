import "server-only";
import { sonarrClient } from "./client";
import { ArrRequestError, arrRequest } from "./request";
import { queueSeriesWrite } from "./series-writes";
import type { SeriesMonitor } from "@/components/tv/series-add";
import type { components as SonarrComponents } from "./generated/sonarr";

type SeriesResource = SonarrComponents["schemas"]["SeriesResource"];

/** The season number is not in the series' season list (or the series itself is gone). */
export class SeasonNotFoundError extends Error {
  constructor() {
    super("Season not found");
    this.name = "SeasonNotFoundError";
  }
}

/**
 * Sets one episode's own monitored flag (Sonarr's episode monitor endpoint). Only the episode id and the boolean
 * are sent, and no query parameters.
 */
export async function setEpisodeMonitored(episodeId: number, monitored: boolean): Promise<void> {
  const client = sonarrClient();
  const body = { episodeIds: [episodeId], monitored };
  await arrRequest("Sonarr episode monitor", (signal) => client.PUT("/api/v3/episode/monitor", { body, signal }));
}

/**
 * Sets one season's monitored flag the way Sonarr's own UI does: read the series, change only that season, and
 * write the series back. Sonarr then sets that season's episodes to match. The series is sent exactly as Sonarr
 * returned it, apart from that one flag. moveFiles is never sent, so Sonarr doesn't move any files.
 *
 * Not Sonarr's seasonpass endpoint: without monitoring options it resets every episode in every season to its
 * season's flag, which would wipe per-episode choices in the other seasons.
 *
 * Throws SeasonNotFoundError when Sonarr answers 404 for the series or the season number isn't in its list. Then
 * no PUT is made. `onSend` runs just before the PUT, so a caller can tell whether a failure came before or after
 * anything was written.
 */
export async function setSeasonMonitored(
  seriesId: number,
  seasonNumber: number,
  monitored: boolean,
  onSend: () => void = () => {},
): Promise<void> {
  // Queued with every other MediaHub write to this series (see series-writes.ts), so each GET sees the previous PUT.
  await queueSeriesWrite(seriesId, () => writeSeasonMonitored(seriesId, seasonNumber, monitored, onSend));
}

async function writeSeasonMonitored(
  seriesId: number,
  seasonNumber: number,
  monitored: boolean,
  onSend: () => void,
): Promise<void> {
  const client = sonarrClient();
  const series = await arrRequest("Sonarr series", (signal) =>
    client.GET("/api/v3/series/{id}", { params: { path: { id: seriesId } }, signal }),
  ).catch((error: unknown) => {
    if (error instanceof ArrRequestError && error.status === 404) throw new SeasonNotFoundError();
    throw error;
  });
  if (!series) throw new ArrRequestError("Sonarr series response was empty", "invalid");

  const seasons = series.seasons ?? [];
  if (!seasons.some((season) => season.seasonNumber === seasonNumber)) throw new SeasonNotFoundError();

  const body: SeriesResource = {
    ...series,
    seasons: seasons.map((season) => (season.seasonNumber === seasonNumber ? { ...season, monitored } : season)),
  };
  onSend();
  // The path id is a string in the generated type. Only the id from the caller goes into it.
  await arrRequest("Sonarr series update", (signal) =>
    client.PUT("/api/v3/series/{id}", { params: { path: { id: String(seriesId) } }, body, signal }),
  );
}

/**
 * Applies a monitoring preset to every episode of one series once (Sonarr's season pass endpoint, as its own
 * Episode Monitoring screen does). Sonarr doesn't store the preset. Only the series id and the preset are sent:
 * never a monitored flag or a season list, and always the monitoring options, because without them Sonarr resets
 * every episode to its season's flag (see setSeasonMonitored). Sonarr then rewrites the season flags to match the
 * episodes, and "none" also unmonitors the series. Queued with the other writes to this series.
 */
export async function applySeriesMonitorPreset(seriesId: number, monitor: SeriesMonitor): Promise<void> {
  await queueSeriesWrite(seriesId, async () => {
    const client = sonarrClient();
    const body = { series: [{ id: seriesId }], monitoringOptions: { monitor } };
    await arrRequest("Sonarr season pass", (signal) => client.POST("/api/v3/seasonpass", { body, signal }));
  });
}

/**
 * Asks Sonarr to search for releases for one season's monitored episodes (its SeasonSearch command). Sonarr queues
 * the command and answers at once. Only the command name and the ids are sent.
 */
export async function searchSeason(seriesId: number, seasonNumber: number): Promise<void> {
  const client = sonarrClient();
  // CommandResource doesn't declare the command's own fields, so the body is built as a variable.
  const body = { name: "SeasonSearch", seriesId, seasonNumber };
  await arrRequest("Sonarr season search command", (signal) => client.POST("/api/v3/command", { body, signal }));
}

/**
 * Asks Sonarr to search for releases for one episode (its EpisodeSearch command). Sonarr queues the command and
 * answers at once. Only the command name and the episode id are sent.
 */
export async function searchEpisode(episodeId: number): Promise<void> {
  const client = sonarrClient();
  // CommandResource doesn't declare the command's own fields, so the body is built as a variable.
  const body = { name: "EpisodeSearch", episodeIds: [episodeId] };
  await arrRequest("Sonarr episode search command", (signal) => client.POST("/api/v3/command", { body, signal }));
}

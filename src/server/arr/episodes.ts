import "server-only";
import { sonarrClient } from "./client";
import { ArrRequestError, arrRequest } from "./request";
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
 * The last season write queued for each series. MediaHub runs as one Node process, so chaining on this makes
 * season toggles for one series from different tabs or admins run one at a time, and each GET sees the previous
 * PUT. (One browser tab already sends its server actions one at a time; the server doesn't queue them.)
 *
 * Known gaps, accepted because each needs two writers on one series within seconds: a PUT that timed out may
 * still land after the next queued GET; and any other write to the series between our GET and PUT (Sonarr's own
 * UI, or a bulk edit from the TV table, which isn't queued here) can be overwritten. That is the same trade-off
 * Sonarr's own UI makes.
 */
const seasonWrites = new Map<number, Promise<void>>();

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
  const previous = seasonWrites.get(seriesId) ?? Promise.resolve();
  // Wait for the previous write whether it worked or not; its caller already gets its own error.
  const write = previous.catch(() => {}).then(() => writeSeasonMonitored(seriesId, seasonNumber, monitored, onSend));
  seasonWrites.set(seriesId, write);
  try {
    await write;
  } finally {
    // Only the newest write clears the entry, so the map doesn't grow and a queued write is never dropped.
    if (seasonWrites.get(seriesId) === write) seasonWrites.delete(seriesId);
  }
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

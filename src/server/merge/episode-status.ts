import "server-only";
import type { components as SonarrComponents } from "../arr/generated/sonarr";

type EpisodeResource = SonarrComponents["schemas"]["EpisodeResource"];

export type EpisodeStatus = "downloaded" | "missing" | "unaired" | "unmonitored";

/**
 * An episode's status, by these rules in order: file, then monitored, then air date. `wanted` is true only when
 * the series, the season and the episode are all monitored, which is when Sonarr searches for it. Shared by the
 * series page and the calendar, so both agree.
 */
export function episodeStatus(episode: EpisodeResource, wanted: boolean, now: number): EpisodeStatus {
  if (episode.hasFile === true) return "downloaded";
  if (!wanted) return "unmonitored";
  const airDateUtc = episode.airDateUtc || null;
  // Also covers an air date that doesn't parse, so it is not reported as missing.
  if (airDateUtc === null || !(Date.parse(airDateUtc) <= now)) return "unaired";
  return "missing";
}

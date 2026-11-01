import "server-only";
import { sonarrClient } from "./client";
import { ArrRequestError, arrRequest, getList } from "./request";
import { usableProfiles } from "./profiles";
import { fetchQualityProfiles, seriesStatus, type SeriesStatus } from "./series";
import type { components as SonarrComponents } from "./generated/sonarr";

type SeriesResource = SonarrComponents["schemas"]["SeriesResource"];
type SeasonResource = SonarrComponents["schemas"]["SeasonResource"];
type EpisodeResource = SonarrComponents["schemas"]["EpisodeResource"];
type QualityProfileResource = SonarrComponents["schemas"]["QualityProfileResource"];

export type EpisodeStatus = "downloaded" | "missing" | "unaired" | "unmonitored";

/** One episode, reduced to what the detail page shows. No file paths. */
export type EpisodeRow = {
  id: number;
  episodeNumber: number;
  /** "TBA" when Sonarr has no title. */
  title: string;
  /** The local date it aired, "YYYY-MM-DD", or null. */
  airDate: string | null;
  status: EpisodeStatus;
  monitored: boolean;
  /** The file's quality name when the episode has a file, otherwise null. */
  quality: string | null;
  /** The file's size in bytes, or 0 when there is no file. */
  size: number;
};

export type SeasonRow = {
  seasonNumber: number;
  /** "Specials" for season 0, otherwise "Season N". */
  label: string;
  monitored: boolean;
  episodeFileCount: number;
  episodeCount: number;
  totalEpisodeCount: number;
  sizeOnDisk: number;
  episodes: EpisodeRow[];
};

export type SeriesDetail = {
  id: number;
  title: string;
  year: number | null;
  status: SeriesStatus;
  network: string | null;
  overview: string;
  monitored: boolean;
  qualityProfile: string;
  hasPoster: boolean;
  seasons: SeasonRow[];
};

/** Sonarr's airDate is the local calendar date it aired, "YYYY-MM-DD". Anything else shows as no date. */
const AIR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Maps one episode. Status follows the rules in this order: file, then monitored, then air date. `wanted` is
 * true only when the series, the season and the episode are all monitored, which is when Sonarr searches for it.
 */
function toEpisodeRow(episode: EpisodeResource, id: number, episodeNumber: number, wanted: boolean, now: number): EpisodeRow {
  const hasFile = episode.hasFile === true;
  const file = hasFile ? episode.episodeFile : undefined;
  const airDateUtc = episode.airDateUtc || null;

  let status: EpisodeStatus;
  if (hasFile) {
    status = "downloaded";
  } else if (!wanted) {
    status = "unmonitored";
  } else if (airDateUtc === null || !(Date.parse(airDateUtc) <= now)) {
    // Also covers an air date that doesn't parse, so it is not reported as missing.
    status = "unaired";
  } else {
    status = "missing";
  }

  return {
    id,
    episodeNumber,
    title: episode.title || "TBA",
    // The local date, not airDateUtc: a 9pm US airing is already the next day in UTC.
    airDate: episode.airDate && AIR_DATE.test(episode.airDate) ? episode.airDate : null,
    status,
    monitored: episode.monitored ?? false,
    quality: file?.quality?.quality?.name ?? null,
    size: file?.size ?? 0,
  };
}

/** Season 0 is Specials and sorts last. Otherwise the highest season number comes first. */
function compareSeasons(a: number, b: number): number {
  if (a === 0 && b !== 0) return 1;
  if (b === 0 && a !== 0) return -1;
  return b - a;
}

/**
 * Pure: maps one series, its episodes and the quality profiles to the detail page's shape. Returns null when
 * the series has no numeric id or no title. Episodes without a numeric id, season or episode number are skipped.
 * Every season that Sonarr lists or that an episode belongs to gets a row, so no episode is dropped.
 */
export function toSeriesDetail(
  series: SeriesResource,
  episodes: EpisodeResource[],
  profiles: QualityProfileResource[],
  now: number,
): SeriesDetail | null {
  if (typeof series.id !== "number" || !series.title) return null;

  const profileNames = new Map(usableProfiles(profiles).map((p) => [p.id, p.name]));
  // Sonarr always sends a profile id; 0 is only a fallback that matches no profile.
  const qualityProfileId = series.qualityProfileId ?? 0;

  const seasonsByNumber = new Map<number, SeasonResource>();
  for (const season of series.seasons ?? []) {
    if (typeof season.seasonNumber === "number") seasonsByNumber.set(season.seasonNumber, season);
  }

  const episodesBySeason = new Map<number, EpisodeRow[]>();
  for (const episode of episodes) {
    if (typeof episode.id !== "number" || typeof episode.seasonNumber !== "number" || typeof episode.episodeNumber !== "number") {
      continue;
    }
    const wanted =
      series.monitored === true &&
      seasonsByNumber.get(episode.seasonNumber)?.monitored === true &&
      episode.monitored === true;
    const row = toEpisodeRow(episode, episode.id, episode.episodeNumber, wanted, now);
    const list = episodesBySeason.get(episode.seasonNumber) ?? [];
    list.push(row);
    episodesBySeason.set(episode.seasonNumber, list);
  }

  const seasonNumbers = new Set([...seasonsByNumber.keys(), ...episodesBySeason.keys()]);
  const seasons: SeasonRow[] = [...seasonNumbers].sort(compareSeasons).map((seasonNumber) => {
    const season = seasonsByNumber.get(seasonNumber);
    // Counts are missing when Sonarr omits statistics, so they fall back to zero.
    const stats = season?.statistics;
    const seasonEpisodes = episodesBySeason.get(seasonNumber) ?? [];
    seasonEpisodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
    return {
      seasonNumber,
      label: seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`,
      monitored: season?.monitored ?? false,
      episodeFileCount: stats?.episodeFileCount ?? 0,
      episodeCount: stats?.episodeCount ?? 0,
      totalEpisodeCount: stats?.totalEpisodeCount ?? 0,
      sizeOnDisk: stats?.sizeOnDisk ?? 0,
      episodes: seasonEpisodes,
    };
  });

  return {
    id: series.id,
    title: series.title,
    year: typeof series.year === "number" && series.year > 0 ? series.year : null,
    status: seriesStatus(series),
    network: series.network || null,
    overview: series.overview ?? "",
    monitored: series.monitored ?? false,
    // The same fallback label as toSeriesRows, so the table and the detail page agree.
    qualityProfile: profileNames.get(qualityProfileId) ?? `Unknown profile (#${qualityProfileId})`,
    hasPoster: series.images?.some((image) => image.coverType === "poster") ?? false,
    seasons,
  };
}

/**
 * One series with its seasons and episodes, for the detail page. Returns null when Sonarr answers 404 for the
 * series itself, so the page can show not-found. A 404 from the episode or profile request means something
 * else (e.g. a wrong URL base), so it propagates like any other failure.
 */
export async function getSeriesDetail(seriesId: number): Promise<SeriesDetail | null> {
  const client = sonarrClient();
  const seriesRequest = arrRequest("Sonarr series", (signal) =>
    client.GET("/api/v3/series/{id}", { params: { path: { id: seriesId } }, signal }),
  ).catch((error: unknown) => {
    if (error instanceof ArrRequestError && error.status === 404) return null;
    throw error;
  });
  const [series, episodes, profiles] = await Promise.all([
    seriesRequest,
    getList("Sonarr episodes", (signal) =>
      client.GET("/api/v3/episode", {
        params: { query: { seriesId, includeEpisodeFile: true } },
        signal,
      }),
    ),
    fetchQualityProfiles(),
  ]);
  if (series === null) return null;
  if (!series) throw new ArrRequestError("Sonarr series response was empty", "invalid");
  return toSeriesDetail(series, episodes, profiles, Date.now());
}

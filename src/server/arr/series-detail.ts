import "server-only";
import { sonarrClient } from "./client";
import { ArrRequestError, arrRequest, getList } from "./request";
import { sortedProfileOptions, usableProfiles, type QualityProfileOption } from "./profiles";
import { fetchQualityProfiles, seriesStatus, type SeriesStatus } from "./series";
import { genreList, imdbIdOrNull, positiveIdOrNull, ratingValue, textOrNull } from "./detail-fields";
import { tvdbImagePath } from "./series-add";
import { episodeStatus, type EpisodeStatus } from "../merge/episode-status";
import { isNewItemMonitor, isSeriesType, type NewItemMonitor, type SeriesType } from "@/components/tv/series-edit";
import type { components as SonarrComponents } from "./generated/sonarr";

type SeriesResource = SonarrComponents["schemas"]["SeriesResource"];
type SeasonResource = SonarrComponents["schemas"]["SeasonResource"];
type EpisodeResource = SonarrComponents["schemas"]["EpisodeResource"];
type QualityProfileResource = SonarrComponents["schemas"]["QualityProfileResource"];

export type { EpisodeStatus };

/** One episode, reduced to what the detail page shows. No file paths. */
export type EpisodeRow = {
  id: number;
  episodeNumber: number;
  /** "TBA" when Sonarr has no title. */
  title: string;
  /** The local date it aired, "YYYY-MM-DD", or null. */
  airDate: string | null;
  status: EpisodeStatus;
  /**
   * The episode's own flag, as Sonarr sends it. It ignores series and season monitoring, so it doesn't say
   * whether Sonarr will search; `status` does. Kept for the per-episode monitor toggle.
   */
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
  /**
   * The TVDB path of the season's poster (see tvdbImagePath), or null. Null for a season that is only there
   * because an episode belongs to it, and for a poster on any other host. The browser fetches it from the TVDB lookup-poster route (/api/tv/lookup-poster/).
   */
  posterPath: string | null;
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
  /** The profile's id, which the settings form starts from. */
  qualityProfileId: number;
  /** Sonarr's series type when it is one the form offers, otherwise null. */
  seriesType: SeriesType | null;
  seasonFolder: boolean;
  /** Sonarr's "monitor new seasons" value when it is one the form offers, otherwise null. */
  monitorNewItems: NewItemMonitor | null;
  hasPoster: boolean;
  /** True when Sonarr has a backdrop (fanart) for the series. The browser then fetches it from MediaHub's backdrop route. */
  hasBackdrop: boolean;
  /** Up to five non-empty genres, in Sonarr's order. */
  genres: string[];
  /** Sonarr's content rating (e.g. "TV-MA"), or null when it sends none. */
  certification: string | null;
  /** The episode runtime in minutes, or null when Sonarr sends none (or 0). */
  runtime: number | null;
  /** Sonarr's rating value, or null when it has no votes or a zero value. */
  rating: number | null;
  /** Sonarr's first air date as an ISO string, or null. The page formats it. */
  firstAired: string | null;
  /** Sonarr's last air date as an ISO string, or null. The page formats it. */
  lastAired: string | null;
  /** Sonarr's next airing as an ISO string, or null. The page formats it. */
  nextAiring: string | null;
  /** When the series was added to Sonarr, as an ISO string, or null. The page formats it. */
  added: string | null;
  /** The original language's name, or null. */
  language: string | null;
  /** Episodes with a file, from Sonarr's statistics. 0 when Sonarr sends none. */
  episodeFileCount: number;
  /** Sonarr's statistics episodeCount. 0 when Sonarr sends none. */
  episodeCount: number;
  /** Bytes on disk for the whole series, from Sonarr's statistics. 0 when Sonarr sends none. */
  sizeOnDisk: number;
  /** The IMDb id (e.g. "tt0000001") when it has the expected shape, otherwise null. */
  imdbId: string | null;
  /** The TVDB series id when it is a positive integer, otherwise null. */
  tvdbId: number | null;
  /** The TMDB series id when it is a positive integer, otherwise null. */
  tmdbId: number | null;
  seasons: SeasonRow[];
};

/** Sonarr's airDate is the local calendar date it aired, "YYYY-MM-DD". Anything else shows as no date. */
const AIR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Maps one episode. See episodeStatus (src/server/merge/episode-status.ts) for the status rules. */
function toEpisodeRow(episode: EpisodeResource, id: number, episodeNumber: number, wanted: boolean, now: number): EpisodeRow {
  const hasFile = episode.hasFile === true;
  const file = hasFile ? episode.episodeFile : undefined;
  const status = episodeStatus(episode, wanted, now);

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
      posterPath: tvdbImagePath(season?.images?.find((image) => image.coverType === "poster")?.remoteUrl),
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
    qualityProfileId,
    seriesType: isSeriesType(series.seriesType) ? series.seriesType : null,
    seasonFolder: series.seasonFolder === true,
    monitorNewItems: isNewItemMonitor(series.monitorNewItems) ? series.monitorNewItems : null,
    hasPoster: series.images?.some((image) => image.coverType === "poster") ?? false,
    hasBackdrop: series.images?.some((image) => image.coverType === "fanart") ?? false,
    genres: genreList(series.genres),
    certification: textOrNull(series.certification),
    runtime: typeof series.runtime === "number" && series.runtime > 0 ? series.runtime : null,
    rating: ratingValue(series.ratings),
    firstAired: textOrNull(series.firstAired),
    lastAired: textOrNull(series.lastAired),
    nextAiring: textOrNull(series.nextAiring),
    added: textOrNull(series.added),
    language: textOrNull(series.originalLanguage?.name),
    episodeFileCount: series.statistics?.episodeFileCount ?? 0,
    episodeCount: series.statistics?.episodeCount ?? 0,
    sizeOnDisk: series.statistics?.sizeOnDisk ?? 0,
    imdbId: imdbIdOrNull(series.imdbId),
    tvdbId: positiveIdOrNull(series.tvdbId),
    tmdbId: positiveIdOrNull(series.tmdbId),
    seasons,
  };
}

/** What the series page loads: the series, and the quality profiles the settings form offers (the page only uses them for admins). */
export type SeriesDetailPage = { detail: SeriesDetail; profiles: QualityProfileOption[] };

/**
 * One series with its seasons and episodes, for the detail page, with the quality profiles from the same request.
 * Returns null when Sonarr answers 404 for the series itself, so the page can show not-found. A 404 from the episode
 * or profile request means something else (e.g. a wrong URL base), so it propagates like any other failure.
 */
export async function getSeriesDetail(seriesId: number): Promise<SeriesDetailPage | null> {
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
  const detail = toSeriesDetail(series, episodes, profiles, Date.now());
  if (detail === null) return null;
  return { detail, profiles: sortedProfileOptions(profiles) };
}

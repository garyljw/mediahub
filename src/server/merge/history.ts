import "server-only";
import type { components as RadarrComponents } from "../arr/generated/radarr";
import type { components as SonarrComponents } from "../arr/generated/sonarr";
import { formatSize } from "@/components/library/format";
import { episodeCode } from "@/components/library/release";
import type { HistoryEventFilter } from "@/components/history/history-params";
import { hasPoster } from "./images";
import { toPeek, type Peek } from "./peek";
import { formatLocalDateTime } from "./local-time";

type MovieHistoryRecord = RadarrComponents["schemas"]["HistoryResource"];
type EpisodeHistoryRecord = SonarrComponents["schemas"]["HistoryResource"];
type UpstreamEventType =
  | RadarrComponents["schemas"]["MovieHistoryEventType"]
  | SonarrComponents["schemas"]["EpisodeHistoryEventType"];

export type HistoryEvent = "grabbed" | "imported" | "failed" | "deleted" | "renamed" | "ignored" | "unknown";

/** The details a row can expand to show. Each is text, or null when the record doesn't have it. */
export type HistoryDetails = {
  sourceTitle: string | null;
  indexer: string | null;
  downloadClient: string | null;
  releaseGroup: string | null;
  /** Formatted with formatSize, e.g. "1.5 GB". */
  size: string | null;
  message: string | null;
  /** The camelCase reason split into words, e.g. "Missing from disk". */
  reason: string | null;
};

/**
 * One line of the History page. This is the only shape that leaves the server for a history record: no download IDs,
 * no upstream URLs and no raw `data` map. sourceTitle and message are passed on as Radarr/Sonarr wrote them.
 */
export type HistoryEntry = {
  /** Unique within the list: `movie-${historyId}` or `episode-${historyId}`. */
  key: string;
  app: "radarr" | "sonarr";
  /** The record's id in Radarr or Sonarr. Used by "Mark as failed". */
  historyId: number;
  /** The record's date as sent by the Arr, an ISO date-time. Sorting uses it. */
  date: string;
  /** The time formatted for display in the display time zone. Built on the server. */
  when: string;
  kind: "movie" | "episode";
  event: HistoryEvent;
  /** The movie title, or the series title. "Unknown movie" or "Unknown series" when the record doesn't include one. */
  title: string;
  /** Movie: its year, or "". Episode: "S02E05 · Episode title", or "" when the episode is missing. */
  detail: string;
  quality: string | null;
  /** MediaHub's own poster route, only when the included resource has a poster. */
  posterSrc: string | null;
  /** The hover card's facts (year, genres, overview) for the movie or series, or null when there is nothing to show. */
  peek: Peek | null;
  /** Episodes with a known series link to its page. Movies have no page, so null. */
  href: string | null;
  /** Only grabbed records can be marked as failed. */
  canMarkFailed: boolean;
  details: HistoryDetails;
};

/** The data keys this module reads. Everything else in `data` (download and NZB URLs among them) is never read. */
const DATA_FIELDS = ["indexer", "downloadClientName", "releaseGroup", "size", "message", "reason"] as const;
type DataField = (typeof DATA_FIELDS)[number];

/** Every event type name in the generated Radarr and Sonarr types, so a renamed or missing one fails to compile. */
const EVENT_BY_TYPE: Record<UpstreamEventType, HistoryEvent> = {
  unknown: "unknown",
  grabbed: "grabbed",
  downloadFolderImported: "imported",
  movieFolderImported: "imported",
  seriesFolderImported: "imported",
  downloadFailed: "failed",
  movieFileDeleted: "deleted",
  episodeFileDeleted: "deleted",
  movieFileRenamed: "renamed",
  episodeFileRenamed: "renamed",
  downloadIgnored: "ignored",
};

/**
 * Integer event codes for each filter category, checked against the MovieHistoryEventType and EpisodeHistoryEventType
 * enums in the Radarr and Sonarr source (develop, Nov 2026). The generated types only carry the names. Unknown (0) is
 * in no category, so it only shows when no category is ticked.
 */
const RADARR_CODES: Record<HistoryEventFilter, number[]> = {
  grabbed: [1],
  imported: [3, 7],
  failed: [4],
  deleted: [6],
  renamed: [8],
  ignored: [9],
};

const SONARR_CODES: Record<HistoryEventFilter, number[]> = {
  grabbed: [1],
  imported: [2, 3],
  failed: [4],
  deleted: [5],
  renamed: [6],
  ignored: [7],
};

/** Radarr's eventType codes for the ticked categories. An empty list means no event filter. */
export function radarrEventCodes(events: HistoryEventFilter[]): number[] {
  return events.flatMap((event) => RADARR_CODES[event]);
}

/** Sonarr's eventType codes for the ticked categories. An empty list means no event filter. */
export function sonarrEventCodes(events: HistoryEventFilter[]): number[] {
  return events.flatMap((event) => SONARR_CODES[event]);
}

/** The event category of an upstream eventType name. Anything not listed is "unknown". */
export function eventOf(eventType: string | null | undefined): HistoryEvent {
  if (!eventType || !Object.hasOwn(EVENT_BY_TYPE, eventType)) return "unknown";
  return EVENT_BY_TYPE[eventType as UpstreamEventType];
}

/**
 * Reads only the allowlisted keys from a record's data map, matching keys without regard to case. Values aren't
 * non-empty strings are skipped.
 */
function readData(data: { [key: string]: string | null } | null | undefined): Partial<Record<DataField, string>> {
  const found: Partial<Record<DataField, string>> = {};
  if (!data) return found;
  for (const [key, value] of Object.entries(data)) {
    const field = DATA_FIELDS.find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (!field || typeof value !== "string" || value.trim() === "" || found[field] !== undefined) continue;
    found[field] = value.trim();
  }
  return found;
}

/**
 * "MissingFromDisk" becomes "Missing from disk". Words that are all capitals (acronyms) keep their capitals. The
 * text is not explained here.
 */
export function reasonText(value: string): string | null {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_]+/)
    .filter((word) => word !== "");
  if (words.length === 0) return null;
  const text = words.map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase())).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A byte count from data.size as text, e.g. "1.5 GB". Null when it isn't a positive number. */
function sizeText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0 ? formatSize(bytes) : null;
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** An entry plus the values it sorts by. Neither leaves the server. */
type Sortable = { entry: HistoryEntry; time: number };

/** The time and id a record must have to be listed. Returns null for a record that can't be shown or sorted. */
function validRecord(record: { id?: unknown; date?: unknown }): { historyId: number; date: string; time: number } | null {
  if (typeof record.id !== "number" || !Number.isInteger(record.id) || record.id <= 0) return null;
  if (typeof record.date !== "string") return null;
  const time = Date.parse(record.date);
  if (Number.isNaN(time)) return null;
  return { historyId: record.id, date: record.date, time };
}

function detailsOf(record: MovieHistoryRecord | EpisodeHistoryRecord): HistoryDetails {
  const data = readData(record.data);
  return {
    sourceTitle: nonEmpty(record.sourceTitle),
    indexer: data.indexer ?? null,
    downloadClient: data.downloadClientName ?? null,
    releaseGroup: data.releaseGroup ?? null,
    size: sizeText(data.size),
    message: data.message ?? null,
    reason: data.reason !== undefined ? reasonText(data.reason) : null,
  };
}

function movieSortable(record: MovieHistoryRecord, timeZone: string): Sortable | null {
  const base = validRecord(record);
  if (base === null) return null;
  const movie = record.movie;
  const movieId = typeof movie?.id === "number" ? movie.id : null;
  const event = eventOf(record.eventType);
  return {
    time: base.time,
    entry: {
      key: `movie-${base.historyId}`,
      app: "radarr",
      historyId: base.historyId,
      date: base.date,
      when: formatLocalDateTime(base.date, timeZone),
      kind: "movie",
      event,
      title: nonEmpty(movie?.title) ?? "Unknown movie",
      detail: movie?.year ? String(movie.year) : "",
      quality: nonEmpty(record.quality?.quality?.name),
      posterSrc: movieId !== null && hasPoster(movie?.images) ? `/api/movies/${movieId}/poster` : null,
      peek: toPeek(movie),
      href: null,
      canMarkFailed: event === "grabbed",
      details: detailsOf(record),
    },
  };
}

function episodeSortable(record: EpisodeHistoryRecord, timeZone: string): Sortable | null {
  const base = validRecord(record);
  if (base === null) return null;
  const episode = record.episode;
  const series = record.series;
  const seriesId = typeof series?.id === "number" ? series.id : null;
  const event = eventOf(record.eventType);
  const season = episode?.seasonNumber;
  const number = episode?.episodeNumber;
  return {
    time: base.time,
    entry: {
      key: `episode-${base.historyId}`,
      app: "sonarr",
      historyId: base.historyId,
      date: base.date,
      when: formatLocalDateTime(base.date, timeZone),
      kind: "episode",
      event,
      title: nonEmpty(series?.title) ?? "Unknown series",
      detail:
        episode && typeof season === "number" && typeof number === "number"
          ? `${episodeCode(season, number)} · ${nonEmpty(episode.title) ?? "TBA"}`
          : "",
      quality: nonEmpty(record.quality?.quality?.name),
      posterSrc: seriesId !== null && hasPoster(series?.images) ? `/api/tv/${seriesId}/poster` : null,
      peek: toPeek(series),
      href: seriesId !== null ? `/tv/${seriesId}` : null,
      canMarkFailed: event === "grabbed",
      details: detailsOf(record),
    },
  };
}

/**
 * Pure: builds the History list from Radarr movie records and Sonarr episode records. Drops records without a
 * numeric id or a parseable date. Sorts newest first, with ties broken by key, and keeps the first `limit`. The
 * time text is formatted in `timeZone`.
 */
export function toHistoryEntries(
  movieRecords: MovieHistoryRecord[],
  episodeRecords: EpisodeHistoryRecord[],
  limit: number,
  timeZone: string,
): HistoryEntry[] {
  const items: Sortable[] = [];
  for (const record of movieRecords) {
    const item = movieSortable(record, timeZone);
    if (item !== null) items.push(item);
  }
  for (const record of episodeRecords) {
    const item = episodeSortable(record, timeZone);
    if (item !== null) items.push(item);
  }

  items.sort((a, b) => {
    if (a.time !== b.time) return b.time - a.time;
    return a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0;
  });
  return items.slice(0, limit).map((item) => item.entry);
}

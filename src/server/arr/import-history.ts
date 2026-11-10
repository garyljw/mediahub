import "server-only";
import { radarrClient, sonarrClient } from "./client";
import { ArrRequestError, arrRequest } from "./request";
import { getConnection, type ArrApp } from "@/server/settings/connections";

/** Radarr's and Sonarr's event code for DownloadFolderImported: a file was imported into the library. */
const IMPORTED_EVENT = 3;
/** The first walk asks for big pages. Later walks only need the newest few. */
const FULL_PAGE_SIZE = 1000;
const RECENT_PAGE_SIZE = 250;
/** A hard cap on pages per walk, so a huge history can't hold the page for long. */
const MAX_PAGES = 20;

/** One import: the movie or series it was for, and when it was imported (epoch ms and the text Radarr or Sonarr sent). */
type Imported = { id: number; time: number; date: string };
/** One history page, reduced to its imports. `count` is every record on the page, including any that were skipped. */
type ImportPage = { totalRecords: number; count: number; imports: Imported[] };
/** What is kept per connection: the newest import date per id, and the newest import time seen (epoch ms). */
type ImportCache = { dates: Map<number, string>; newest: number };

const caches = new Map<string, ImportCache>();

/** Test-only: forgets every cached import date. */
export function resetImportHistoryCache(): void {
  caches.clear();
}

/**
 * Checks a history reply and keeps the records that have an id and a parsable date. Anything else is an invalid
 * reply, not an empty history.
 */
function toPage<T extends { date?: string }>(
  label: string,
  data: { totalRecords?: number; records?: T[] | null } | undefined,
  idOf: (record: T) => number | undefined,
): ImportPage {
  if (!data || typeof data.totalRecords !== "number" || !Array.isArray(data.records)) {
    throw new ArrRequestError(`${label} response was not a history page`, "invalid");
  }
  const imports: Imported[] = [];
  for (const record of data.records) {
    const id = idOf(record);
    const date = record.date;
    const time = typeof date === "string" ? Date.parse(date) : Number.NaN;
    if (typeof id === "number" && typeof date === "string" && !Number.isNaN(time)) {
      imports.push({ id, time, date });
    }
  }
  return { totalRecords: data.totalRecords, count: data.records.length, imports };
}

/** One page of Radarr's import records, newest first. */
async function radarrPage(page: number, pageSize: number): Promise<ImportPage> {
  const client = radarrClient();
  const data = await arrRequest("Radarr import history", (signal) =>
    client.GET("/api/v3/history", {
      params: {
        query: { page, pageSize, sortKey: "date", sortDirection: "descending", eventType: [IMPORTED_EVENT] },
      },
      signal,
    }),
  );
  return toPage("Radarr import history", data, (record) => record.movieId);
}

/** One page of Sonarr's import records, newest first. */
async function sonarrPage(page: number, pageSize: number): Promise<ImportPage> {
  const client = sonarrClient();
  const data = await arrRequest("Sonarr import history", (signal) =>
    client.GET("/api/v3/history", {
      params: {
        query: { page, pageSize, sortKey: "date", sortDirection: "descending", eventType: [IMPORTED_EVENT] },
      },
      signal,
    }),
  );
  return toPage("Sonarr import history", data, (record) => record.seriesId);
}

/** Keeps the later import date for an id. */
function mergeImport(dates: Map<number, string>, imported: Imported): void {
  const existing = dates.get(imported.id);
  if (existing === undefined || Date.parse(existing) < imported.time) dates.set(imported.id, imported.date);
}

/** Walks the whole import history, in big pages, up to the cap or the end. */
async function fullWalk(fetchPage: (page: number, pageSize: number) => Promise<ImportPage>): Promise<ImportCache> {
  const dates = new Map<number, string>();
  let newest = Number.NEGATIVE_INFINITY;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const reply = await fetchPage(page, FULL_PAGE_SIZE);
    for (const imported of reply.imports) {
      mergeImport(dates, imported);
      newest = Math.max(newest, imported.time);
    }
    if (reply.count === 0 || page * FULL_PAGE_SIZE >= reply.totalRecords) break;
  }
  return { dates, newest };
}

/**
 * Reads only what is new since the last walk: pages of the newest records, stopping at the first record older than the
 * newest import the cache already has. The cached dates are kept and merged with the new ones.
 */
async function incrementalWalk(
  fetchPage: (page: number, pageSize: number) => Promise<ImportPage>,
  cached: ImportCache,
): Promise<ImportCache> {
  const dates = new Map(cached.dates);
  let newest = cached.newest;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const reply = await fetchPage(page, RECENT_PAGE_SIZE);
    let reachedOld = false;
    for (const imported of reply.imports) {
      if (imported.time < cached.newest) {
        reachedOld = true;
        break;
      }
      mergeImport(dates, imported);
      newest = Math.max(newest, imported.time);
    }
    if (reachedOld || reply.count === 0 || page * RECENT_PAGE_SIZE >= reply.totalRecords) break;
  }
  return { dates, newest };
}

/**
 * The newest import date per id, for one app. With no connection, nothing is requested and the map is empty. A failed
 * request logs one fixed line, and gives the cached dates if there are any, otherwise "failed". The URL and key never
 * reach the log.
 */
async function importDates(
  app: ArrApp,
  label: string,
  fetchPage: (page: number, pageSize: number) => Promise<ImportPage>,
): Promise<Map<number, string> | "failed"> {
  const connection = getConnection(app);
  if (!connection) return new Map();
  const key = `${app}|${connection.url}`;
  const cached = caches.get(key);
  try {
    const result = cached ? await incrementalWalk(fetchPage, cached) : await fullWalk(fetchPage);
    caches.set(key, result);
    return new Map(result.dates);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    console.error(`Home page: ${label} could not be loaded`);
    return cached ? new Map(cached.dates) : "failed";
  }
}

/** The newest import date for each movie that has one, by movie id. */
export function movieImportDates(): Promise<Map<number, string> | "failed"> {
  return importDates("radarr", "Radarr import history", radarrPage);
}

/** The newest import date for each series that has one, by series id. */
export function seriesImportDates(): Promise<Map<number, string> | "failed"> {
  return importDates("sonarr", "Sonarr import history", sonarrPage);
}

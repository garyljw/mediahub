import "server-only";
import { sonarrClient } from "./client";
import { ArrRequestError, getList } from "./request";
import type { SeriesRow } from "./series";
import { getConnection } from "@/server/settings/connections";
import type { components as SonarrComponents } from "./generated/sonarr";

type EpisodeFileResource = SonarrComponents["schemas"]["EpisodeFileResource"];

/** How many episode-file requests run at once, so a big library doesn't flood Sonarr. */
const MAX_IN_FLIGHT = 4;

/**
 * The newest download date per series, kept for the life of the process. An entry is reused while the series' file count
 * and size on disk are unchanged, so a series is only asked again after something was downloaded or removed. The key
 * includes the Sonarr URL, so a changed connection never reads another server's entries. The URL is never logged.
 */
type CacheEntry = { episodeFileCount: number; sizeOnDisk: number; value: string | null };
const cache = new Map<string, CacheEntry>();

/** Test-only: forgets every cached download date. */
export function resetSeriesDownloadedCache(): void {
  cache.clear();
}

/** The newest parsable dateAdded among the files, as Sonarr sent it, or null when there is none. */
function newestDateAdded(files: EpisodeFileResource[]): string | null {
  let newest: string | null = null;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (const file of files) {
    if (typeof file.dateAdded !== "string") continue;
    const time = Date.parse(file.dateAdded);
    if (Number.isNaN(time)) continue;
    if (time > newestTime) {
      newestTime = time;
      newest = file.dateAdded;
    }
  }
  return newest;
}

/** Asks Sonarr for one series' episode files. Sonarr refuses this call without seriesId, so it is always sent. */
async function fetchNewestDate(seriesId: number): Promise<string | null> {
  const client = sonarrClient();
  const files = await getList("Sonarr episode files", (signal) =>
    client.GET("/api/v3/episodefile", { params: { query: { seriesId } }, signal }),
  );
  return newestDateAdded(files);
}

/** Runs `work` on every item, with at most `limit` running at once. */
async function runLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(workers);
}

/** The download dates by series id, and whether any series' date couldn't be loaded. */
export type SeriesDownloaded = { dates: Map<number, string | null>; failed: boolean };

/**
 * The date each series' newest episode file was added, keyed by series id. Series with no files get null without a
 * request. A series whose request fails gets null and is not cached. A timeout or network failure means Sonarr isn't
 * answering, so the series not yet asked get null without a request, instead of each waiting out its own timeout.
 * Failures are logged as one fixed line, never with the error, URL or key. With no Sonarr connection, every series
 * gets null and nothing is requested.
 */
export async function seriesDownloadedAt(rows: SeriesRow[]): Promise<SeriesDownloaded> {
  const result = new Map<number, string | null>();
  const connection = getConnection("sonarr");
  if (!connection) {
    for (const row of rows) result.set(row.id, null);
    return { dates: result, failed: false };
  }

  const toFetch: SeriesRow[] = [];
  for (const row of rows) {
    if (row.episodeFileCount === 0) {
      result.set(row.id, null);
      continue;
    }
    const cached = cache.get(cacheKey(connection.url, row.id));
    if (cached && cached.episodeFileCount === row.episodeFileCount && cached.sizeOnDisk === row.sizeOnDisk) {
      result.set(row.id, cached.value);
      continue;
    }
    toFetch.push(row);
  }

  let failed = false;
  let unreachable = false;
  await runLimited(toFetch, MAX_IN_FLIGHT, async (row) => {
    if (unreachable) {
      result.set(row.id, null);
      return;
    }
    try {
      const value = await fetchNewestDate(row.id);
      cache.set(cacheKey(connection.url, row.id), {
        episodeFileCount: row.episodeFileCount,
        sizeOnDisk: row.sizeOnDisk,
        value,
      });
      result.set(row.id, value);
    } catch (error) {
      failed = true;
      if (error instanceof ArrRequestError && (error.kind === "timeout" || error.kind === "network")) unreachable = true;
      result.set(row.id, null);
    }
  });

  if (failed) console.error("Home page: some series download dates could not be loaded");
  return { dates: result, failed };
}

function cacheKey(url: string, seriesId: number): string {
  return `${url}|${seriesId}`;
}

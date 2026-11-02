import "server-only";
import type { SeriesMonitor, SeriesTypeOption } from "@/components/tv/series-add";
import { sonarrClient } from "./client";
import { fetchFixedJpeg } from "./poster";
import { ArrRequestError, arrRequest, getList } from "./request";
import { toRootFolderOptions, type RootFolderOption } from "./root-folders";
import type { components as SonarrComponents } from "./generated/sonarr";

type SeriesResource = SonarrComponents["schemas"]["SeriesResource"];

/** One TVDB search hit, reduced to what the add dialog shows. Nothing else from Sonarr's resource reaches the browser. */
export type SeriesLookupResult = {
  tvdbId: number;
  title: string;
  year: number | null;
  network: string | null;
  overview: string;
  /** True when the series is already in the Sonarr library. */
  inLibrary: boolean;
  /** The TVDB poster path (e.g. "banners/v4/series/81189/posters/5f2e8d5ae9d1c.jpg"), or null. Validated by tvdbPosterPath. */
  posterPath: string | null;
};

/** What the server needs to add one series. The browser never sends a path, a title or a URL. */
export type SeriesAdd = {
  tvdbId: number;
  qualityProfileId: number;
  rootFolderPath: string;
  monitor: SeriesMonitor;
  seriesType: SeriesTypeOption;
  searchForMissingEpisodes: boolean;
};

/** Longest overview sent to the browser, in code points (so an emoji is never cut in half). Longer text is cut and ends with an ellipsis. */
const MAX_OVERVIEW = 300;
/** Most search hits returned. Sonarr can return many; the dialog only needs a short list. */
const MAX_RESULTS = 20;

/**
 * Why an add was refused: "not-found" when TVDB has no usable title for the id, "exists" when the
 * series is already in the library. Thrown from addSeries and mapped to messages in the action.
 */
export class SeriesAddError extends Error {
  constructor(readonly reason: "not-found" | "exists") {
    super(reason === "exists" ? "series already in library" : "series not found");
    this.name = "SeriesAddError";
  }
}

const TVDB_HOST = "artworks.thetvdb.com";
const TVDB_POSTER_BASE = `https://${TVDB_HOST}/`;

/**
 * A TVDB poster path: "banners/", up to five directory levels of letters, digits, "_" or "-", then a bare
 * file name of the same characters ending in ".jpg". Also the only shape the TV poster route accepts.
 */
export const TVDB_POSTER_PATH = /^banners\/(?:[A-Za-z0-9_-]{1,64}\/){0,5}[A-Za-z0-9_-]{1,64}\.jpg$/;

/**
 * The poster path of a TVDB poster URL, or null. Accepts only https, the exact host artworks.thetvdb.com with
 * no port or credentials, no query or fragment, and a path that matches TVDB_POSTER_PATH. WHATWG URL parsing
 * resolves "/../" first, so a traversal can't reach a path outside "banners/".
 */
function posterPathFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== TVDB_HOST ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    const path = url.pathname.slice(1);
    return TVDB_POSTER_PATH.test(path) ? path : null;
  } catch {
    return null;
  }
}

/**
 * The TVDB poster path for a Sonarr series, or null. Tries remotePoster first, then the poster entry's
 * remoteUrl. Each candidate must pass posterPathFromUrl, so a URL on any other host or scheme is ignored.
 */
export function tvdbPosterPath(series: SeriesResource): string | null {
  const posterImage = series.images?.find((image) => image.coverType === "poster")?.remoteUrl;
  return tvdbImagePath(series.remotePoster) ?? tvdbImagePath(posterImage);
}

/**
 * The TVDB poster path of one image URL, or null. Non-strings and empty strings give null, and anything else goes
 * through the same checks as tvdbPosterPath. Used for the series poster and for each season's poster.
 */
export function tvdbImagePath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  return posterPathFromUrl(raw);
}

/** Sonarr's year when it is a real year, otherwise null. */
function yearOrNull(year: unknown): number | null {
  return typeof year === "number" && year > 0 ? year : null;
}

/** Pure: Sonarr search hits to dialog results, in upstream order, capped at MAX_RESULTS. */
export function toSeriesLookupResults(series: SeriesResource[]): SeriesLookupResult[] {
  const results: SeriesLookupResult[] = [];
  for (const entry of series) {
    if (results.length >= MAX_RESULTS) break;
    if (typeof entry.tvdbId !== "number" || !(entry.tvdbId > 0)) continue;
    if (!entry.title) continue;
    // Array.from splits by code point, so the cut and the length check never split a surrogate pair.
    const overviewChars = Array.from(entry.overview ?? "");
    results.push({
      tvdbId: entry.tvdbId,
      title: entry.title,
      year: yearOrNull(entry.year),
      network: entry.network || null,
      overview: overviewChars.length > MAX_OVERVIEW ? `${overviewChars.slice(0, MAX_OVERVIEW - 1).join("")}…` : overviewChars.join(""),
      // Sonarr's lookup fills in the library id for a series already in the library, so no separate library
      // fetch is needed. A missing or zero id means it is not in the library.
      inLibrary: typeof entry.id === "number" && entry.id > 0,
      posterPath: tvdbPosterPath(entry),
    });
  }
  return results;
}

/**
 * Searches TVDB through Sonarr. The term goes in the typed client's query, never into a URL string.
 */
export async function lookupSeries(term: string): Promise<SeriesLookupResult[]> {
  const client = sonarrClient();
  const hits = await getList("Sonarr series lookup", (signal) =>
    client.GET("/api/v3/series/lookup", { params: { query: { term } }, signal }),
  );
  return toSeriesLookupResults(hits);
}

/** Root folders Sonarr can add series to, as dropdown options. */
export async function listSeriesRootFolders(): Promise<RootFolderOption[]> {
  const client = sonarrClient();
  const folders = await getList("Sonarr root folder", (signal) => client.GET("/api/v3/rootfolder", { signal }));
  return toRootFolderOptions(folders);
}

/**
 * Pure: the body for POST /api/v3/series. Only these fields are sent. `titleSlug` and `year` are left out
 * when unknown. With monitor "none" nothing is monitored now or later, so new episodes are not monitored either.
 */
export function seriesAddBody(add: SeriesAdd, found: { title: string; titleSlug: string | null; year: number | null }): SeriesResource {
  const body: SeriesResource = {
    tvdbId: add.tvdbId,
    title: found.title,
    qualityProfileId: add.qualityProfileId,
    rootFolderPath: add.rootFolderPath,
    seriesType: add.seriesType,
    seasonFolder: true,
    monitored: add.monitor !== "none",
    monitorNewItems: add.monitor === "none" ? "none" : "all",
    addOptions: {
      monitor: add.monitor,
      searchForMissingEpisodes: add.searchForMissingEpisodes,
      searchForCutoffUnmetEpisodes: false,
    },
  };
  if (found.titleSlug !== null) body.titleSlug = found.titleSlug;
  if (found.year !== null) body.year = found.year;
  return body;
}

/**
 * Adds one series to Sonarr. Looks the id up again so the title and year come from Sonarr, not from
 * the browser. Refuses a series that is already in the library. `onSend` runs just before the add request
 * goes out, so the caller knows that a later timeout may mean Sonarr added the series.
 */
export async function addSeries(add: SeriesAdd, onSend: () => void = () => {}): Promise<{ title: string; year: number | null }> {
  const client = sonarrClient();

  const hits = await getList("Sonarr series lookup", (signal) =>
    client.GET("/api/v3/series/lookup", { params: { query: { term: `tvdb:${add.tvdbId}` } }, signal }),
  );
  const hit = hits.find((entry) => entry.tvdbId === add.tvdbId);
  if (typeof hit?.title !== "string" || hit.title.trim() === "") throw new SeriesAddError("not-found");
  const title = hit.title;
  const year = yearOrNull(hit.year);
  const titleSlug = typeof hit.titleSlug === "string" && hit.titleSlug !== "" ? hit.titleSlug : null;

  const existing = await getList("Sonarr series", (signal) =>
    client.GET("/api/v3/series", { params: { query: { tvdbId: add.tvdbId } }, signal }),
  );
  if (existing.length > 0) throw new SeriesAddError("exists");

  const body = seriesAddBody(add, { title, titleSlug, year });
  onSend();
  await arrRequest("Sonarr series add", (signal) => client.POST("/api/v3/series", { body, signal }));

  return { title, year };
}

/**
 * One TVDB poster, as JPEG bytes. The path must match TVDB_POSTER_PATH, and the fetch goes to one fixed
 * host with no redirects, no custom headers and no Sonarr key.
 */
export async function getTvdbPoster(path: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!TVDB_POSTER_PATH.test(path)) throw new ArrRequestError("TVDB poster request failed: invalid name", "invalid");
  return fetchFixedJpeg("TVDB poster", `${TVDB_POSTER_BASE}${path}`);
}

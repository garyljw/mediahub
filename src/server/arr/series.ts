import "server-only";
import { sonarrClient } from "./client";
import { cachedArrImage } from "@/server/image-cache";
import { queueSeriesWrite } from "./series-writes";
import { MAX_BACKDROP_BYTES, fetchPosterBytes } from "./poster";
import { DELETE_TIMEOUT_MS, arrRequest, getList } from "./request";
import { sortedProfileOptions, usableProfiles, type QualityProfileOption } from "./profiles";
import type { NewItemMonitor, SeriesType } from "@/components/tv/series-edit";
import type { components as SonarrComponents } from "./generated/sonarr";

type SeriesResource = SonarrComponents["schemas"]["SeriesResource"];
type QualityProfileResource = SonarrComponents["schemas"]["QualityProfileResource"];
type SeriesEditorResource = SonarrComponents["schemas"]["SeriesEditorResource"];

export type SeriesStatus = "continuing" | "ended" | "upcoming";

/** One series, reduced to the fields the library shows. */
export type SeriesRow = {
  id: number;
  title: string;
  year: number | null;
  status: SeriesStatus;
  monitored: boolean;
  qualityProfileId: number;
  qualityProfile: string;
  network: string | null;
  episodeFileCount: number;
  /** Sonarr's statistics.episodeCount: monitored episodes that have aired. This is the "have / want" figure Sonarr shows. */
  episodeCount: number;
  seasonCount: number;
  sizeOnDisk: number;
  added: string | null;
  sortTitle: string;
  /** True when Sonarr has a poster for the series. The browser then fetches it from MediaHub's poster route. */
  hasPoster: boolean;
};

/**
 * Sonarr also sends "deleted" (a series it has marked for removal) and can omit the field. The UI has no
 * state for either, so both show as "ended": neither is still airing, and neither should look upcoming or
 * continuing. The status filter uses the same three values.
 */
export function seriesStatus(series: SeriesResource): SeriesStatus {
  if (series.status === "continuing" || series.status === "upcoming") return series.status;
  return "ended";
}

/**
 * Pure: maps upstream series to rows, in upstream order. Skips series without an id or title. Sorting is done
 * by the caller.
 */
export function toSeriesRows(series: SeriesResource[], profiles: QualityProfileResource[]): SeriesRow[] {
  const profileNames = new Map(usableProfiles(profiles).map((p) => [p.id, p.name]));

  const rows: SeriesRow[] = [];
  for (const entry of series) {
    if (typeof entry.id !== "number" || !entry.title) continue;
    // Sonarr always sends a profile id; 0 is only a fallback that matches no profile.
    const qualityProfileId = entry.qualityProfileId ?? 0;
    // Counts are missing when Sonarr omits statistics, so they fall back to zero.
    const stats = entry.statistics;
    rows.push({
      id: entry.id,
      title: entry.title,
      year: typeof entry.year === "number" && entry.year > 0 ? entry.year : null,
      status: seriesStatus(entry),
      monitored: entry.monitored ?? false,
      qualityProfileId,
      // The profile filter reuses this label for orphaned ids, so the two always match.
      qualityProfile: profileNames.get(qualityProfileId) ?? `Unknown profile (#${qualityProfileId})`,
      network: entry.network || null,
      episodeFileCount: stats?.episodeFileCount ?? 0,
      episodeCount: stats?.episodeCount ?? 0,
      seasonCount: stats?.seasonCount ?? 0,
      sizeOnDisk: stats?.sizeOnDisk ?? 0,
      added: entry.added ?? null,
      sortTitle: (entry.sortTitle || entry.title).toLowerCase(),
      hasPoster: entry.images?.some((image) => image.coverType === "poster") ?? false,
    });
  }

  return rows;
}

/** Every quality profile from Sonarr. Shared with series-detail.ts so the request code lives in one place. */
export async function fetchQualityProfiles(): Promise<QualityProfileResource[]> {
  const client = sonarrClient();
  return getList("Sonarr quality profile", (signal) => client.GET("/api/v3/qualityprofile", { signal }));
}

/** Quality profiles as dropdown options. Used by the edit action to check a chosen profile still exists. */
export async function listSeriesQualityProfiles(): Promise<QualityProfileOption[]> {
  return sortedProfileOptions(await fetchQualityProfiles());
}

/** Series (as table rows) and quality profiles (as dropdown options) from Sonarr. */
export async function listSeries(): Promise<{ rows: SeriesRow[]; profiles: QualityProfileOption[] }> {
  const client = sonarrClient();
  const [series, profiles] = await Promise.all([
    getList("Sonarr series", (signal) => client.GET("/api/v3/series", { signal })),
    fetchQualityProfiles(),
  ]);

  return { rows: toSeriesRows(series, profiles), profiles: sortedProfileOptions(profiles) };
}

/**
 * An edit to one series, from the series' own page. The editor endpoint takes a list of ids, so the body carries
 * this series' id alone. Only these fields are sent, so Sonarr never sees moveFiles, rootFolderPath, tags or
 * anything else from the editor resource.
 */
export type SeriesEdit = {
  seriesId: number;
  qualityProfileId?: number;
  monitored?: boolean;
  seriesType?: SeriesType;
  seasonFolder?: boolean;
  monitorNewItems?: NewItemMonitor;
};

/** Builds the editor body: the one id, plus each field that is defined. Undefined fields are left out, not sent as null. */
function seriesEditorBody(edit: SeriesEdit): SeriesEditorResource {
  const body: SeriesEditorResource = { seriesIds: [edit.seriesId] };
  if (edit.qualityProfileId !== undefined) body.qualityProfileId = edit.qualityProfileId;
  if (edit.monitored !== undefined) body.monitored = edit.monitored;
  if (edit.seriesType !== undefined) body.seriesType = edit.seriesType;
  if (edit.seasonFolder !== undefined) body.seasonFolder = edit.seasonFolder;
  if (edit.monitorNewItems !== undefined) body.monitorNewItems = edit.monitorNewItems;
  return body;
}

/** Changes one Sonarr series' quality profile, monitored flag, type, season folders and new-season monitoring. */
export async function editSeries(edit: SeriesEdit): Promise<void> {
  const client = sonarrClient();
  const body = seriesEditorBody(edit);
  // Queued with the season toggles, which read and write back the whole series (see series-writes.ts).
  await queueSeriesWrite(edit.seriesId, () =>
    arrRequest("Sonarr series edit", (signal) => client.PUT("/api/v3/series/editor", { body, signal })).then(() => {}),
  );
}

/**
 * A bulk delete. Both booleans are always sent, so Sonarr never falls back to its own defaults for either one.
 * Sonarr's name for the exclusion flag is addImportListExclusion (Radarr's is addImportExclusion).
 */
export type SeriesDelete = { seriesIds: number[]; deleteFiles: boolean; addImportListExclusion: boolean };

/** Builds the delete body with exactly these three fields. Nothing else from the editor resource is sent. */
function seriesDeleteBody(del: SeriesDelete): SeriesEditorResource {
  return {
    seriesIds: del.seriesIds,
    deleteFiles: del.deleteFiles,
    addImportListExclusion: del.addImportListExclusion,
  };
}

/** Deletes the given Sonarr series, optionally with their files and with an import list exclusion. */
export async function deleteSeries(del: SeriesDelete): Promise<void> {
  const client = sonarrClient();
  const body = seriesDeleteBody(del);
  await arrRequest("Sonarr series delete", (signal) => client.DELETE("/api/v3/series/editor", { body, signal }), {
    timeoutMs: DELETE_TIMEOUT_MS,
  });
}

/**
 * Asks Sonarr to search for releases for one series (its SeriesSearch command). Sonarr's command takes one
 * series, so a bulk search is one call per series. Sonarr queues the command and answers at once; the
 * searching and any grabbing happen afterwards. Only the command name and the id are sent.
 */
export async function searchSeriesReleases(seriesId: number): Promise<void> {
  const client = sonarrClient();
  // CommandResource doesn't declare the command's own fields (seriesId), so the body is built as a variable.
  const body = { name: "SeriesSearch", seriesId };
  await arrRequest("Sonarr series search command", (signal) => client.POST("/api/v3/command", { body, signal }));
}

/**
 * Asks Sonarr to refresh metadata and rescan disk for the given series (its RefreshSeries command). Sonarr
 * re-reads each series' folder on disk. It queues the command and answers at once. Only the command name and
 * the ids are sent.
 *
 * An empty list must never be sent: Sonarr reads an empty seriesIds as "refresh the whole library". So this
 * throws before any request is made.
 */
export async function refreshSeries(seriesIds: number[]): Promise<void> {
  if (seriesIds.length === 0) throw new Error("refreshSeries needs at least one series id");
  const client = sonarrClient();
  // CommandResource doesn't declare the command's own fields (seriesIds), so the body is built as a variable.
  const body = { name: "RefreshSeries", seriesIds };
  await arrRequest("Sonarr series refresh command", (signal) => client.POST("/api/v3/command", { body, signal }));
}

/** The one Sonarr cover file MediaHub ever fetches. A module constant, so callers never choose the filename. */
const POSTER_FILENAME = "poster-250.jpg";

async function fetchSeriesPoster(seriesId: number): Promise<Uint8Array<ArrayBuffer>> {
  const client = sonarrClient();
  return fetchPosterBytes("Sonarr poster", (signal) =>
    client.GET("/api/v3/mediacover/{seriesId}/{filename}", {
      params: { path: { seriesId, filename: POSTER_FILENAME } },
      parseAs: "stream",
      signal,
    }),
  );
}

/** The one Sonarr backdrop file MediaHub ever fetches. A module constant, so callers never choose the filename. */
const BACKDROP_FILENAME = "fanart.jpg";

async function fetchSeriesBackdrop(seriesId: number): Promise<Uint8Array<ArrayBuffer>> {
  const client = sonarrClient();
  return fetchPosterBytes(
    "Sonarr backdrop",
    (signal) =>
      client.GET("/api/v3/mediacover/{seriesId}/{filename}", {
        params: { path: { seriesId, filename: BACKDROP_FILENAME } },
        parseAs: "stream",
        signal,
      }),
    MAX_BACKDROP_BYTES,
  );
}

/** Sonarr's cached 250px poster for one series, as JPEG bytes, through the disk image cache. */
export async function getSeriesPoster(seriesId: number): Promise<Uint8Array<ArrayBuffer>> {
  return cachedArrImage("sonarr", "poster", seriesId, () => fetchSeriesPoster(seriesId));
}

/** Sonarr's backdrop (fanart) for one series, as JPEG bytes, through the disk image cache. */
export async function getSeriesBackdrop(seriesId: number): Promise<Uint8Array<ArrayBuffer>> {
  return cachedArrImage("sonarr", "backdrop", seriesId, () => fetchSeriesBackdrop(seriesId));
}

import "server-only";
import { sonarrClient } from "./client";
import { fetchPosterBytes } from "./poster";
import { DELETE_TIMEOUT_MS, arrRequest, getList } from "./request";
import { sortedProfileOptions, usableProfiles, type QualityProfileOption } from "./profiles";
import type { components as SonarrComponents } from "./generated/sonarr";

type SeriesResource = SonarrComponents["schemas"]["SeriesResource"];
type QualityProfileResource = SonarrComponents["schemas"]["QualityProfileResource"];
type SeriesEditorResource = SonarrComponents["schemas"]["SeriesEditorResource"];

export type SeriesStatus = "continuing" | "ended" | "upcoming";

/** One series, reduced to the fields the TV table shows. */
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
 * Sonarr also sends "deleted" (a series it has marked for removal) and can omit the field. The table has no
 * state for either, so both show as "ended": neither is still airing, and neither should look upcoming or
 * continuing. The status filter uses the same three values.
 */
function seriesStatus(series: SeriesResource): SeriesStatus {
  if (series.status === "continuing" || series.status === "upcoming") return series.status;
  return "ended";
}

/**
 * Pure: maps upstream series to table rows, in upstream order. Skips series without an id or title. Sorting is
 * the table's job (series-filters.ts), so it lives in one place.
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
      // The filter dropdown reuses this label for orphaned ids, so the two always match.
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

async function fetchQualityProfiles(): Promise<QualityProfileResource[]> {
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
 * A bulk edit. Only these fields are sent, so Sonarr never sees moveFiles, rootFolderPath, tags, seriesType,
 * monitorNewItems or anything else from the editor resource.
 */
export type SeriesEdit = { seriesIds: number[]; qualityProfileId?: number; monitored?: boolean };

/** Builds the editor body. Fields that are undefined are left out, not sent as null. */
function seriesEditorBody(edit: SeriesEdit): SeriesEditorResource {
  const body: SeriesEditorResource = { seriesIds: edit.seriesIds };
  if (edit.qualityProfileId !== undefined) body.qualityProfileId = edit.qualityProfileId;
  if (edit.monitored !== undefined) body.monitored = edit.monitored;
  return body;
}

/** Changes the quality profile and/or monitored flag for the given Sonarr series ids. */
export async function editSeries(edit: SeriesEdit): Promise<void> {
  const client = sonarrClient();
  const body = seriesEditorBody(edit);
  await arrRequest("Sonarr series edit", (signal) => client.PUT("/api/v3/series/editor", { body, signal }));
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

/** The one Sonarr cover file MediaHub ever fetches. A module constant, so callers never choose the filename. */
const POSTER_FILENAME = "poster-250.jpg";

/** Fetches Sonarr's cached 250px poster for one series as JPEG bytes. Only the fixed poster file is requested. */
export async function getSeriesPoster(seriesId: number): Promise<Uint8Array<ArrayBuffer>> {
  const client = sonarrClient();
  return fetchPosterBytes("Sonarr poster", (signal) =>
    client.GET("/api/v3/mediacover/{seriesId}/{filename}", {
      params: { path: { seriesId, filename: POSTER_FILENAME } },
      parseAs: "stream",
      signal,
    }),
  );
}

import "server-only";
import type { components as SonarrComponents } from "../arr/generated/sonarr";
import type { EpisodeImportFile, EpisodeManualImportItem, MovieImportFile, MovieManualImportItem } from "../arr/manual-import";
import { episodeCode } from "@/components/library/release";
import type { ImportCandidate } from "@/components/queue/queue-import";

export type { ImportCandidate };

// The tick rules, the ManualImport command fields and the same-episode refusal below were checked against Radarr's and
// Sonarr's develop source (InteractiveImportRow, InteractiveImportModalContent, ManualImportFile), 2026-11-02.

type EpisodeResource = SonarrComponents["schemas"]["EpisodeResource"];

/**
 * Why a picked file can't be imported. `missing`: the id isn't in the app's scan. `duplicateTarget`: two picked files
 * are for the same movie or the same episode.
 */
export type PickFailure = "missing" | "notImportable" | "duplicateTarget";

export type PickResult<T> = { ok: true; files: T[] } | { ok: false; reason: PickFailure };

/** A positive integer id, or null. */
function validId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** A non-negative integer, or null. Used for season and episode numbers and years. */
function countOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** The trimmed text, or null when it is missing or blank. */
function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** The file size when it is a positive number, or null. */
function sizeOf(item: { size?: number }): number | null {
  const size = item.size;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : null;
}

/**
 * True for a queue item that Radarr's and Sonarr's own queue screens offer a manual import for: status "completed" and
 * trackedDownloadStatus "warning". It also needs a non-blank download id, because the scan is asked for by download id.
 * The Queue merge uses it to show "Force import…", and the server actions check it again before they scan or import.
 */
export function canManualImport(item: {
  status?: string | null;
  trackedDownloadStatus?: string | null;
  downloadId?: string | null;
}): boolean {
  return (
    item.status === "completed" && item.trackedDownloadStatus === "warning" && nonEmpty(item.downloadId) !== null
  );
}

/**
 * Keeps the items whose id is a positive integer and appears exactly once. An id that appears twice is ambiguous, so
 * both items are dropped. The result keeps first-seen order.
 */
function uniqueById<T extends { id?: number | null }>(items: readonly T[]): Map<number, T> {
  const seen = new Map<number, { item: T; count: number }>();
  for (const item of items) {
    const id = validId(item.id);
    if (id === null) continue;
    const entry = seen.get(id);
    if (entry) entry.count += 1;
    else seen.set(id, { item, count: 1 });
  }
  const byId = new Map<number, T>();
  for (const [id, entry] of seen) {
    if (entry.count === 1) byId.set(id, entry.item);
  }
  return byId;
}

/** The file's relative path, else its name, else "Unknown file". */
function nameOf(item: { relativePath?: string | null; name?: string | null }): string {
  return nonEmpty(item.relativePath) ?? nonEmpty(item.name) ?? "Unknown file";
}

/** The app's reasons for rejecting the file: trimmed, non-empty, de-duplicated, in the order given. */
function rejectionsOf(item: { rejections?: { reason?: string | null }[] | null }): string[] {
  const reasons = new Set<string>();
  for (const rejection of item.rejections ?? []) {
    const reason = nonEmpty(rejection.reason);
    if (reason !== null) reasons.add(reason);
  }
  return [...reasons];
}

/**
 * The Radarr file for this item, built from the item's own fields (without the download id, which the pick adds), or
 * null when Radarr wouldn't tick it on its manual import screen. Radarr ticks a file when it has a movie, a quality, a languages list (an empty list counts) and a size
 * above zero. This module also needs a valid movie id and a path, since the command can't be built without them. This
 * is the one place the rule is applied: the candidate's importable flag and the pick both use it.
 */
function movieFileOf(item: MovieManualImportItem): Omit<MovieImportFile, "downloadId"> | null {
  const movieId = validId(item.movie?.id);
  const size = sizeOf(item);
  const path = item.path ?? "";
  if (!item.movie || movieId === null || !item.quality || !Array.isArray(item.languages) || size === null) return null;
  if (path.trim() === "") return null;
  return {
    path,
    folderName: item.folderName ?? null,
    movieId,
    quality: item.quality,
    languages: item.languages,
    releaseGroup: item.releaseGroup ?? null,
    indexerFlags: item.indexerFlags ?? 0,
  };
}

/**
 * The Sonarr file for this item, or null when Sonarr wouldn't tick it. Sonarr ticks a file when it has a series, a
 * season number, at least one episode, a quality, a languages list (an empty list counts) and a size above zero. Every
 * episode needs a valid id, and so does the series, since the command can't be built without them.
 */
function episodeFileOf(item: EpisodeManualImportItem): Omit<EpisodeImportFile, "downloadId"> | null {
  const seriesId = validId(item.series?.id);
  const size = sizeOf(item);
  const path = item.path ?? "";
  if (!item.series || seriesId === null || item.seasonNumber === null || item.seasonNumber === undefined) return null;
  if (!item.quality || !Array.isArray(item.languages) || size === null || path.trim() === "") return null;
  const episodes = item.episodes ?? [];
  if (episodes.length === 0) return null;
  const episodeIds: number[] = [];
  for (const episode of episodes) {
    const id = validId(episode.id);
    if (id === null) return null;
    episodeIds.push(id);
  }
  return {
    path,
    folderName: item.folderName ?? null,
    seriesId,
    episodeIds,
    episodeFileId: item.episodeFileId ?? null,
    quality: item.quality,
    languages: item.languages,
    releaseGroup: item.releaseGroup ?? null,
    indexerFlags: item.indexerFlags ?? 0,
    releaseType: item.releaseType ?? "unknown",
  };
}

function movieCandidate(item: MovieManualImportItem, id: number): ImportCandidate {
  const movie = item.movie;
  const year = countOrNull(movie?.year);
  const title = nonEmpty(movie?.title) ?? "Unknown movie";
  const file = movieFileOf(item);
  return {
    id,
    name: nameOf(item),
    match: movie ? (year !== null && year > 0 ? `${title} (${year})` : title) : null,
    quality: nonEmpty(item.quality?.quality?.name),
    sizeBytes: sizeOf(item),
    rejections: rejectionsOf(item),
    importable: file !== null,
    targets: file === null ? [] : [`movie-${file.movieId}`],
  };
}

/** "S01E02, S01E03" for the episodes that have both numbers. */
function episodeCodesOf(episodes: EpisodeResource[]): string[] {
  const codes: string[] = [];
  for (const episode of episodes) {
    const season = countOrNull(episode.seasonNumber);
    const number = countOrNull(episode.episodeNumber);
    if (season !== null && number !== null) codes.push(episodeCode(season, number));
  }
  return codes;
}

function episodeCandidate(item: EpisodeManualImportItem, id: number): ImportCandidate {
  const series = item.series;
  const title = nonEmpty(series?.title) ?? "Unknown series";
  const codes = episodeCodesOf(item.episodes ?? []);
  const file = episodeFileOf(item);
  return {
    id,
    name: nameOf(item),
    match: series ? (codes.length > 0 ? `${title} · ${codes.join(", ")}` : title) : null,
    quality: nonEmpty(item.quality?.quality?.name),
    sizeBytes: sizeOf(item),
    rejections: rejectionsOf(item),
    importable: file !== null,
    targets: file === null ? [] : file.episodeIds.map((episodeId) => `episode-${episodeId}`),
  };
}

/** Pure: the candidates for Radarr's scan, one per usable id, in the order the scan lists them. */
export function toMovieImportCandidates(items: MovieManualImportItem[]): ImportCandidate[] {
  return [...uniqueById(items)].map(([id, item]) => movieCandidate(item, id));
}

/** Pure: the candidates for Sonarr's scan, one per usable id, in the order the scan lists them. */
export function toEpisodeImportCandidates(items: EpisodeManualImportItem[]): ImportCandidate[] {
  return [...uniqueById(items)].map(([id, item]) => episodeCandidate(item, id));
}

/**
 * Pure: turns the admin's ticked file ids into Radarr command files, built only from the scan's own items. Each id
 * must match exactly one item, and that item must be importable. Two picked files may not be for the same movie.
 * Duplicate ids in the input count once. `downloadId` is the download the server checked, and every file gets it.
 */
export function pickMovieImportFiles(
  items: MovieManualImportItem[],
  fileIds: readonly number[],
  downloadId: string,
): PickResult<MovieImportFile> {
  const byId = uniqueById(items);
  const files: MovieImportFile[] = [];
  const movieIds = new Set<number>();
  for (const fileId of new Set(fileIds)) {
    const item = byId.get(fileId);
    if (!item) return { ok: false, reason: "missing" };
    const file = movieFileOf(item);
    if (file === null) return { ok: false, reason: "notImportable" };
    if (movieIds.has(file.movieId)) return { ok: false, reason: "duplicateTarget" };
    movieIds.add(file.movieId);
    files.push({ ...file, downloadId });
  }
  return { ok: true, files };
}

/**
 * Pure: as pickMovieImportFiles, for Sonarr. Two picked files may not cover the same episode id. Sonarr's own manual
 * import screen refuses that too.
 */
export function pickEpisodeImportFiles(
  items: EpisodeManualImportItem[],
  fileIds: readonly number[],
  downloadId: string,
): PickResult<EpisodeImportFile> {
  const byId = uniqueById(items);
  const files: EpisodeImportFile[] = [];
  const episodeIds = new Set<number>();
  for (const fileId of new Set(fileIds)) {
    const item = byId.get(fileId);
    if (!item) return { ok: false, reason: "missing" };
    const file = episodeFileOf(item);
    if (file === null) return { ok: false, reason: "notImportable" };
    for (const episodeId of file.episodeIds) {
      if (episodeIds.has(episodeId)) return { ok: false, reason: "duplicateTarget" };
      episodeIds.add(episodeId);
    }
    files.push({ ...file, downloadId });
  }
  return { ok: true, files };
}

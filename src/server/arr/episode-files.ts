import "server-only";
import { sonarrClient } from "./client";
import { ArrRequestError, DELETE_TIMEOUT_MS, arrRequest, getList } from "./request";

/** One episode a file delete would affect: labels and flags only, no paths. */
export type AffectedEpisode = {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  /** The file this episode holds. The preview sends the plan's file ids, not this per-episode link. */
  fileId: number;
  /** Series, season and episode are all monitored, the same rule the series page uses for status. */
  wanted: boolean;
};

export type FileDeletePlan = {
  /** The distinct Sonarr file ids that would be deleted. */
  fileIds: number[];
  /** Every episode of the series that holds one of those files, including multi-episode siblings. */
  episodes: AffectedEpisode[];
  totalSize: number;
};

export type FileDeleteTarget = { seasonNumber: number } | { episodeId: number };

/**
 * Works out which files deleting one season's or one episode's files would remove, from Sonarr's episode list for
 * the series (includeEpisodeFile, as the series page reads it). A file shared by several episodes takes all of
 * them into the plan. Nothing is written.
 */
export async function planFileDelete(seriesId: number, target: FileDeleteTarget): Promise<FileDeletePlan> {
  const client = sonarrClient();
  const [series, episodes] = await Promise.all([
    arrRequest("Sonarr series", (signal) =>
      client.GET("/api/v3/series/{id}", { params: { path: { id: seriesId } }, signal }),
    ),
    getList("Sonarr episodes", (signal) =>
      client.GET("/api/v3/episode", { params: { query: { seriesId, includeEpisodeFile: true } }, signal }),
    ),
  ]);
  if (!series) throw new ArrRequestError("Sonarr series response was empty", "invalid");

  const seasonMonitored = new Map<number, boolean>();
  for (const season of series.seasons ?? []) {
    if (typeof season.seasonNumber === "number") seasonMonitored.set(season.seasonNumber, season.monitored === true);
  }

  const fileIds = new Set<number>();
  for (const episode of episodes) {
    const fileId = episode.episodeFileId;
    if (typeof fileId !== "number" || fileId <= 0 || episode.hasFile !== true) continue;
    const inTarget =
      "episodeId" in target ? episode.id === target.episodeId : episode.seasonNumber === target.seasonNumber;
    if (inTarget) fileIds.add(fileId);
  }

  const affected: AffectedEpisode[] = [];
  const sizes = new Map<number, number>();
  for (const episode of episodes) {
    const fileId = episode.episodeFileId;
    if (typeof fileId !== "number" || !fileIds.has(fileId)) continue;
    if (typeof episode.id !== "number" || typeof episode.seasonNumber !== "number" || typeof episode.episodeNumber !== "number") {
      continue;
    }
    sizes.set(fileId, episode.episodeFile?.size ?? sizes.get(fileId) ?? 0);
    affected.push({
      id: episode.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      title: episode.title || "TBA",
      fileId,
      wanted:
        series.monitored === true && seasonMonitored.get(episode.seasonNumber) === true && episode.monitored === true,
    });
  }
  affected.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);

  let totalSize = 0;
  for (const size of sizes.values()) totalSize += size;
  return { fileIds: [...fileIds].sort((a, b) => a - b), episodes: affected, totalSize };
}

export type DeleteSettings = {
  /** Sonarr's "Unmonitor Deleted Episodes" setting: Sonarr unmonitors episodes whose file is deleted. */
  sonarrUnmonitorsDeleted: boolean;
  /** Whether a Recycle Bin is set. The path itself is never kept. */
  recycleBinSet: boolean;
};

/** Reads the two Media Management settings the delete dialog explains. Nothing else, and never the Recycle Bin path. */
export async function getDeleteSettings(): Promise<DeleteSettings> {
  const client = sonarrClient();
  const config = await arrRequest("Sonarr media management", (signal) =>
    client.GET("/api/v3/config/mediamanagement", { signal }),
  );
  if (!config) throw new ArrRequestError("Sonarr media management response was empty", "invalid");
  return {
    sonarrUnmonitorsDeleted: config.autoUnmonitorPreviouslyDownloadedEpisodes === true,
    recycleBinSet: typeof config.recycleBin === "string" && config.recycleBin.trim() !== "",
  };
}

/**
 * Deletes episode files through Sonarr's normal file delete (to its Recycle Bin when one is set, otherwise
 * permanently). Sonarr refuses the whole request when any id is unknown, and treats every file as belonging to the
 * first file's series, so callers pass only ids found for one series. An empty list is a bug here: Sonarr errors on it.
 */
export async function deleteEpisodeFiles(fileIds: number[]): Promise<void> {
  if (fileIds.length === 0) throw new Error("deleteEpisodeFiles needs at least one file id");
  const client = sonarrClient();
  const body = { episodeFileIds: fileIds };
  await arrRequest("Episode file delete", (signal) => client.DELETE("/api/v3/episodefile/bulk", { body, signal }), {
    timeoutMs: DELETE_TIMEOUT_MS,
  });
}

/** Sets the given episodes' monitored flag to false (Sonarr's episode monitor endpoint). */
export async function unmonitorEpisodes(episodeIds: number[]): Promise<void> {
  if (episodeIds.length === 0) return;
  const client = sonarrClient();
  const body = { episodeIds, monitored: false };
  await arrRequest("Episode unmonitor", (signal) => client.PUT("/api/v3/episode/monitor", { body, signal }));
}

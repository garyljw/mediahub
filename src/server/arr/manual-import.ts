import "server-only";
import { radarrClient, sonarrClient } from "./client";
import { arrRequest, getList } from "./request";
import type { components as RadarrComponents } from "./generated/radarr";
import type { components as SonarrComponents } from "./generated/sonarr";

/** Scanning a download folder on a NAS can be slow, so the scan gets longer than the default request timeout. */
export const SCAN_TIMEOUT_MS = 60_000;

export type MovieManualImportItem = RadarrComponents["schemas"]["ManualImportResource"];
export type EpisodeManualImportItem = SonarrComponents["schemas"]["ManualImportResource"];

// Radarr and Sonarr declare different quality enums, so each file type uses its own app's generated model.
type RadarrQualityModel = RadarrComponents["schemas"]["QualityModel"];
type SonarrQualityModel = SonarrComponents["schemas"]["QualityModel"];
type RadarrLanguage = RadarrComponents["schemas"]["Language"];
type SonarrLanguage = SonarrComponents["schemas"]["Language"];
type ReleaseType = SonarrComponents["schemas"]["ReleaseType"];

/** One file in a Radarr ManualImport command. Built from the server's own GET reply, never from the browser. */
export type MovieImportFile = {
  path: string;
  folderName: string | null;
  movieId: number;
  quality: RadarrQualityModel;
  languages: RadarrLanguage[];
  releaseGroup: string | null;
  indexerFlags: number;
  downloadId: string | null;
};

/** One file in a Sonarr ManualImport command. Built from the server's own GET reply, never from the browser. */
export type EpisodeImportFile = {
  path: string;
  folderName: string | null;
  seriesId: number;
  episodeIds: number[];
  episodeFileId: number | null;
  quality: SonarrQualityModel;
  languages: SonarrLanguage[];
  releaseGroup: string | null;
  indexerFlags: number;
  releaseType: ReleaseType;
  downloadId: string | null;
};

/**
 * Radarr's manual import scan for one tracked download (its manualimport route), with filterExistingFiles true as
 * Radarr's own default. Only the download id is sent.
 */
export async function fetchMovieManualImport(downloadId: string): Promise<MovieManualImportItem[]> {
  const client = radarrClient();
  return getList(
    "Radarr manual import",
    (signal) =>
      client.GET("/api/v3/manualimport", {
        params: { query: { downloadId, filterExistingFiles: true } },
        signal,
      }),
    { timeoutMs: SCAN_TIMEOUT_MS },
  );
}

/** Sonarr's manual import scan for one tracked download. Same query as the Radarr scan, on Sonarr's route. */
export async function fetchEpisodeManualImport(downloadId: string): Promise<EpisodeManualImportItem[]> {
  const client = sonarrClient();
  return getList(
    "Sonarr manual import",
    (signal) =>
      client.GET("/api/v3/manualimport", {
        params: { query: { downloadId, filterExistingFiles: true } },
        signal,
      }),
    { timeoutMs: SCAN_TIMEOUT_MS },
  );
}

/**
 * Asks Radarr to import the given files (its ManualImport command). CommandResource doesn't declare the command's own fields, so the body is built as a variable.
 */
export async function startMovieManualImport(files: MovieImportFile[]): Promise<void> {
  const client = radarrClient();
  const body = { name: "ManualImport", importMode: "auto", files };
  await arrRequest("Radarr manual import command", (signal) => client.POST("/api/v3/command", { body, signal }));
}

/** Asks Sonarr to import the given files (its ManualImport command). Same shape as the Radarr command. */
export async function startEpisodeManualImport(files: EpisodeImportFile[]): Promise<void> {
  const client = sonarrClient();
  const body = { name: "ManualImport", importMode: "auto", files };
  await arrRequest("Sonarr manual import command", (signal) => client.POST("/api/v3/command", { body, signal }));
}

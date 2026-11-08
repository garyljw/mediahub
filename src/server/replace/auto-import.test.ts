import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeManualImportItem, MovieManualImportItem } from "@/server/arr/manual-import";
import { ArrRequestError } from "@/server/arr/request";

const mocks = vi.hoisted(() => ({
  pendingReplaceGrabs: vi.fn(),
  setReplaceDownloadId: vi.fn(),
  deleteReplaceGrab: vi.fn(),
  fetchMovieHistory: vi.fn(),
  fetchEpisodeHistory: vi.fn(),
  fetchMovieQueue: vi.fn(),
  fetchEpisodeQueue: vi.fn(),
  fetchMovieManualImport: vi.fn(),
  fetchEpisodeManualImport: vi.fn(),
  startMovieManualImport: vi.fn(),
  startEpisodeManualImport: vi.fn(),
}));

// The store is mocked, so these tests check the worker's decisions and what it sends upstream.
vi.mock("./replace-grabs", () => ({
  pendingReplaceGrabs: mocks.pendingReplaceGrabs,
  setReplaceDownloadId: mocks.setReplaceDownloadId,
  deleteReplaceGrab: mocks.deleteReplaceGrab,
}));

vi.mock("@/server/arr/history", () => ({
  fetchMovieHistory: mocks.fetchMovieHistory,
  fetchEpisodeHistory: mocks.fetchEpisodeHistory,
}));

vi.mock("@/server/arr/queue", () => ({
  fetchMovieQueue: mocks.fetchMovieQueue,
  fetchEpisodeQueue: mocks.fetchEpisodeQueue,
}));

vi.mock("@/server/arr/manual-import", () => ({
  fetchMovieManualImport: mocks.fetchMovieManualImport,
  fetchEpisodeManualImport: mocks.fetchEpisodeManualImport,
  startMovieManualImport: mocks.startMovieManualImport,
  startEpisodeManualImport: mocks.startEpisodeManualImport,
}));

import { runReplaceImports } from "./auto-import";

const UPGRADE = "Not an upgrade for existing episode file(s). Existing quality: WEBDL-1080p. New Quality WEBDL-480p.";
const GUID = "https://indexer.test/details/1";

/** A Sonarr scan item with valid fields, so the pick can build the command. Typed loosely, like the fixtures. */
function scanItem(id: number, reason: string | null): EpisodeManualImportItem {
  return {
    id,
    path: `/fake/downloads/Show.S01E0${id}.mkv`,
    relativePath: `Show.S01E0${id}.mkv`,
    name: `Show.S01E0${id}`,
    size: 1000,
    series: { id: 10, title: "Fake Show" },
    seasonNumber: 1,
    episodes: [{ id: id * 10, seasonNumber: 1, episodeNumber: id }],
    quality: { quality: { id: 3, name: "WEBDL-480p" }, revision: { version: 1, real: 0, isRepack: false } },
    languages: [{ id: 1, name: "English" }],
    rejections: reason === null ? [] : [{ type: "permanent", reason }],
  } as unknown as EpisodeManualImportItem;
}

function movieScanItem(id: number, reason: string): MovieManualImportItem {
  return {
    id,
    path: `/fake/downloads/Movie.${id}.mkv`,
    relativePath: `Movie.${id}.mkv`,
    name: `Movie.${id}`,
    size: 1000,
    movie: { id: 20, title: "Fake Movie", year: 2001 },
    quality: { quality: { id: 7, name: "HD-720p" }, revision: { version: 1, real: 0, isRepack: false } },
    languages: [{ id: 1, name: "English" }],
    rejections: [{ type: "permanent", reason }],
  } as unknown as MovieManualImportItem;
}

/** A Sonarr queue item for a download. Only the fields the worker reads. */
function queueItem(id: number, downloadId: string, status: string, trackedDownloadStatus: string) {
  return { id, downloadId, status, trackedDownloadStatus } as never;
}

function pending(overrides: { id: number; app: "radarr" | "sonarr"; downloadId: string | null }) {
  return { guid: GUID, createdAt: 0, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pendingReplaceGrabs.mockReturnValue([]);
  mocks.fetchMovieHistory.mockResolvedValue({ totalRecords: 0, records: [] });
  mocks.fetchEpisodeHistory.mockResolvedValue({ totalRecords: 0, records: [] });
  mocks.fetchMovieQueue.mockResolvedValue([]);
  mocks.fetchEpisodeQueue.mockResolvedValue([]);
  mocks.fetchMovieManualImport.mockResolvedValue([]);
  mocks.fetchEpisodeManualImport.mockResolvedValue([]);
  mocks.startMovieManualImport.mockResolvedValue(undefined);
  mocks.startEpisodeManualImport.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("runReplaceImports", () => {
  it("makes no upstream call when nothing is remembered", async () => {
    await runReplaceImports();

    expect(mocks.fetchEpisodeHistory).not.toHaveBeenCalled();
    expect(mocks.fetchEpisodeQueue).not.toHaveBeenCalled();
    expect(mocks.fetchMovieQueue).not.toHaveBeenCalled();
    expect(mocks.fetchMovieHistory).not.toHaveBeenCalled();
  });

  it("finds the download id from the grabbed record with the same guid, and ignores the others", async () => {
    mocks.pendingReplaceGrabs.mockReturnValue([pending({ id: 1, app: "sonarr", downloadId: null })]);
    mocks.fetchEpisodeHistory.mockResolvedValue({
      totalRecords: 3,
      records: [
        { downloadId: "DL-OTHER", data: { guid: "https://indexer.test/details/other" } },
        { downloadId: "  ", data: { guid: GUID } },
        { downloadId: "DL-1", data: { guid: GUID } },
      ],
    });
    // The download is still downloading, so the test ends after the id is stored.
    mocks.fetchEpisodeQueue.mockResolvedValue([queueItem(5, "DL-1", "downloading", "ok")]);

    await runReplaceImports();

    expect(mocks.fetchEpisodeHistory).toHaveBeenCalledWith(100, [1]);
    expect(mocks.setReplaceDownloadId).toHaveBeenCalledTimes(1);
    expect(mocks.setReplaceDownloadId).toHaveBeenCalledWith(1, "DL-1");
  });

  it("forgets a grab whose download has left the queue, and imports nothing", async () => {
    mocks.pendingReplaceGrabs.mockReturnValue([pending({ id: 1, app: "sonarr", downloadId: "DL-1" })]);
    mocks.fetchEpisodeQueue.mockResolvedValue([]);

    await runReplaceImports();

    expect(mocks.deleteReplaceGrab).toHaveBeenCalledWith(1);
    expect(mocks.fetchEpisodeManualImport).not.toHaveBeenCalled();
    expect(mocks.startEpisodeManualImport).not.toHaveBeenCalled();
  });

  it("keeps a fresh grab that isn't in the queue yet", async () => {
    const now = 1_000_000_000;
    mocks.pendingReplaceGrabs.mockReturnValue([{ ...pending({ id: 1, app: "sonarr", downloadId: "DL-1" }), createdAt: now - 60_000 }]);
    mocks.fetchEpisodeQueue.mockResolvedValue([]);

    await runReplaceImports(now);

    expect(mocks.deleteReplaceGrab).not.toHaveBeenCalled();
  });

  it("sends the manual import for only the files that are just not an upgrade, and forgets the grab", async () => {
    mocks.pendingReplaceGrabs.mockReturnValue([pending({ id: 1, app: "sonarr", downloadId: "DL-1" })]);
    mocks.fetchEpisodeQueue.mockResolvedValue([queueItem(5, "DL-1", "completed", "warning")]);
    mocks.fetchEpisodeManualImport.mockResolvedValue([
      scanItem(1, UPGRADE),
      scanItem(2, "Sample"),
      scanItem(3, null),
    ]);

    await runReplaceImports();

    expect(mocks.fetchEpisodeManualImport).toHaveBeenCalledWith("DL-1");
    expect(mocks.startEpisodeManualImport).toHaveBeenCalledTimes(1);
    expect(mocks.startEpisodeManualImport).toHaveBeenCalledWith([
      expect.objectContaining({ path: "/fake/downloads/Show.S01E01.mkv", downloadId: "DL-1", episodeIds: [10] }),
    ]);
    expect(mocks.deleteReplaceGrab).toHaveBeenCalledWith(1);
    expect(console.log).toHaveBeenCalledWith("Replace import: sent 1 file(s) to Sonarr.");
  });

  it("sends nothing, forgets the grab and logs once when a file has another rejection as well", async () => {
    mocks.pendingReplaceGrabs.mockReturnValue([pending({ id: 1, app: "sonarr", downloadId: "DL-1" })]);
    mocks.fetchEpisodeQueue.mockResolvedValue([queueItem(5, "DL-1", "completed", "warning")]);
    mocks.fetchEpisodeManualImport.mockResolvedValue([scanItem(1, "Sample"), scanItem(2, "Sample")]);

    await runReplaceImports();

    expect(mocks.startEpisodeManualImport).not.toHaveBeenCalled();
    expect(mocks.deleteReplaceGrab).toHaveBeenCalledWith(1);
    expect(console.log).toHaveBeenCalledWith("Replace import: a download needs a manual import in Sonarr.");
  });

  it("forgets the grab before sending, so a command that fails is never sent again", async () => {
    mocks.pendingReplaceGrabs.mockReturnValue([pending({ id: 1, app: "sonarr", downloadId: "DL-1" })]);
    mocks.fetchEpisodeQueue.mockResolvedValue([queueItem(5, "DL-1", "completed", "warning")]);
    mocks.fetchEpisodeManualImport.mockResolvedValue([
      scanItem(1, "Not an upgrade for existing episode file(s). Existing quality: WEBDL-1080p. New Quality WEBDL-480p."),
    ]);
    mocks.startEpisodeManualImport.mockRejectedValue(new ArrRequestError("Sonarr manual import command request failed: timeout", "timeout"));

    await runReplaceImports();

    expect(mocks.deleteReplaceGrab).toHaveBeenCalledWith(1);
    expect(mocks.deleteReplaceGrab.mock.invocationCallOrder[0]).toBeLessThan(mocks.startEpisodeManualImport.mock.invocationCallOrder[0]);
    expect(console.error).toHaveBeenCalledWith("Replace import: Sonarr manual import command request failed: timeout");
  });

  it("sends a Radarr import over the existing movie file the same way", async () => {
    mocks.pendingReplaceGrabs.mockReturnValue([pending({ id: 2, app: "radarr", downloadId: "DL-M" })]);
    mocks.fetchMovieQueue.mockResolvedValue([queueItem(7, "DL-M", "completed", "warning")]);
    mocks.fetchMovieManualImport.mockResolvedValue([
      movieScanItem(8, "Not an upgrade for existing movie file. Existing quality: Bluray-1080p. New Quality: HD-720p."),
    ]);

    await runReplaceImports();

    expect(mocks.startMovieManualImport).toHaveBeenCalledWith([expect.objectContaining({ movieId: 20, downloadId: "DL-M" })]);
    expect(mocks.deleteReplaceGrab).toHaveBeenCalledWith(2);
  });

  it("leaves a download that is still downloading alone", async () => {
    mocks.pendingReplaceGrabs.mockReturnValue([pending({ id: 1, app: "sonarr", downloadId: "DL-1" })]);
    mocks.fetchEpisodeQueue.mockResolvedValue([queueItem(5, "DL-1", "downloading", "ok")]);

    await runReplaceImports();

    expect(mocks.fetchEpisodeManualImport).not.toHaveBeenCalled();
    expect(mocks.startEpisodeManualImport).not.toHaveBeenCalled();
    expect(mocks.deleteReplaceGrab).not.toHaveBeenCalled();
  });

  it("logs a safe message for an app's request failure, still runs the other app, and keeps the rows", async () => {
    mocks.pendingReplaceGrabs.mockReturnValue([
      pending({ id: 1, app: "radarr", downloadId: "DL-M" }),
      pending({ id: 2, app: "sonarr", downloadId: "DL-S" }),
    ]);
    mocks.fetchMovieQueue.mockRejectedValue(new ArrRequestError("Radarr queue request failed: HTTP 500", "http", 500));
    mocks.fetchEpisodeQueue.mockResolvedValue([]);

    await runReplaceImports();

    expect(console.error).toHaveBeenCalledWith("Replace import: Radarr queue request failed: HTTP 500");
    expect(mocks.deleteReplaceGrab).toHaveBeenCalledWith(2);
    expect(mocks.deleteReplaceGrab).not.toHaveBeenCalledWith(1);
  });

  it("skips an app that isn't set up without logging, and still runs the other app", async () => {
    mocks.pendingReplaceGrabs.mockReturnValue([
      pending({ id: 1, app: "radarr", downloadId: "DL-M" }),
      pending({ id: 2, app: "sonarr", downloadId: "DL-S" }),
    ]);
    mocks.fetchMovieQueue.mockRejectedValue(new ArrRequestError("Radarr isn't set up", "unconfigured"));
    mocks.fetchEpisodeQueue.mockResolvedValue([]);

    await runReplaceImports();

    expect(console.error).not.toHaveBeenCalled();
    expect(mocks.deleteReplaceGrab).toHaveBeenCalledWith(2);
  });

  it("rethrows an error that is not an Arr request failure", async () => {
    mocks.pendingReplaceGrabs.mockReturnValue([pending({ id: 1, app: "sonarr", downloadId: "DL-1" })]);
    mocks.fetchEpisodeQueue.mockRejectedValue(new Error("worker bug"));

    await expect(runReplaceImports()).rejects.toThrow("worker bug");
  });

  it("returns at once, with no upstream call, when a run is already in progress", async () => {
    mocks.pendingReplaceGrabs.mockReturnValue([pending({ id: 1, app: "sonarr", downloadId: "DL-1" })]);
    let release: () => void = () => {};
    mocks.fetchEpisodeQueue.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve([queueItem(5, "DL-1", "downloading", "ok")]))),
    );

    const first = runReplaceImports();
    await runReplaceImports();

    expect(mocks.pendingReplaceGrabs).toHaveBeenCalledTimes(1);
    expect(mocks.fetchEpisodeQueue).toHaveBeenCalledTimes(1);

    release();
    await first;
  });
});

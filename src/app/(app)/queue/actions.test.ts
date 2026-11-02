import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";
import type { components as RadarrComponents } from "@/server/arr/generated/radarr";
import type { components as SonarrComponents } from "@/server/arr/generated/sonarr";
import type { EpisodeManualImportItem, MovieManualImportItem } from "@/server/arr/manual-import";
import radarrScanFixture from "@/server/merge/__fixtures__/radarr-manualimport.json";
import sonarrScanFixture from "@/server/merge/__fixtures__/sonarr-manualimport.json";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  fetchMovieQueue: vi.fn(),
  fetchEpisodeQueue: vi.fn(),
  removeMovieQueueItem: vi.fn(),
  removeEpisodeQueueItem: vi.fn(),
  fetchMovieManualImport: vi.fn(),
  fetchEpisodeManualImport: vi.fn(),
  startMovieManualImport: vi.fn(),
  startEpisodeManualImport: vi.fn(),
  refresh: vi.fn(),
}));

// AuthzError must be a real class: the action checks `instanceof AuthzError`.
vi.mock("@/server/authz", () => {
  class AuthzError extends Error {
    constructor(readonly status: 401 | 403) {
      super(status === 401 ? "unauthorized" : "forbidden");
      this.name = "AuthzError";
    }
  }
  return { AuthzError, requireRole: mocks.requireRole };
});

vi.mock("@/server/arr/queue", () => ({
  fetchMovieQueue: mocks.fetchMovieQueue,
  fetchEpisodeQueue: mocks.fetchEpisodeQueue,
  removeMovieQueueItem: mocks.removeMovieQueueItem,
  removeEpisodeQueueItem: mocks.removeEpisodeQueueItem,
}));

vi.mock("@/server/arr/manual-import", () => ({
  fetchMovieManualImport: mocks.fetchMovieManualImport,
  fetchEpisodeManualImport: mocks.fetchEpisodeManualImport,
  startMovieManualImport: mocks.startMovieManualImport,
  startEpisodeManualImport: mocks.startEpisodeManualImport,
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import { AuthzError } from "@/server/authz";
import { forceImportQueueItem, loadForceImport, removeQueueItem } from "./actions";

type MovieQueueItem = RadarrComponents["schemas"]["QueueResource"];
type EpisodeQueueItem = SonarrComponents["schemas"]["QueueResource"];

const DENIED = "You don't have permission to remove downloads.";
const OPTIONS = { removeFromClient: true, blocklist: false, skipRedownload: false };

// A Sonarr season pack: three items, one download, smallest id 101.
const PACK: EpisodeQueueItem[] = [
  { id: 103, seriesId: 10, downloadId: "DL-PACK", episodeId: 1003 },
  { id: 101, seriesId: 10, downloadId: "DL-PACK", episodeId: 1001 },
  { id: 102, seriesId: 10, downloadId: "DL-PACK", episodeId: 1002 },
];
const MOVIES: MovieQueueItem[] = [{ id: 7, movieId: 70 }];

// Force import: the scans are the fixture files (the server reads these; the browser never sends them).
const RADARR_SCAN = radarrScanFixture as unknown as MovieManualImportItem[];
const SONARR_SCAN = sonarrScanFixture as unknown as EpisodeManualImportItem[];
const DENIED_IMPORT = "You don't have permission to import downloads.";
const CANNOT_IMPORT = "That download can't be imported right now.";
const NO_LONGER = "That download is no longer in the queue.";

// A finished Radarr download the apps left for manual import (completed with a warning).
const STUCK_MOVIE: MovieQueueItem[] = [
  { id: 7, movieId: 70, downloadId: "LEAK-DL-ALPHA", status: "completed", trackedDownloadStatus: "warning" },
];
// A Sonarr download: one finished item left for import, and one still downloading, so the row counts as stuck.
const STUCK_PACK: EpisodeQueueItem[] = [
  {
    id: 101,
    seriesId: 10,
    episodeId: 1001,
    downloadId: "LEAK-DL-DELTA",
    status: "completed",
    trackedDownloadStatus: "warning",
  },
  { id: 102, seriesId: 10, episodeId: 1002, downloadId: "LEAK-DL-DELTA", status: "downloading", trackedDownloadStatus: "ok" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.fetchMovieQueue.mockResolvedValue(MOVIES);
  mocks.fetchEpisodeQueue.mockResolvedValue(PACK);
  mocks.removeMovieQueueItem.mockResolvedValue(undefined);
  mocks.removeEpisodeQueueItem.mockResolvedValue(undefined);
  mocks.fetchMovieManualImport.mockResolvedValue(RADARR_SCAN);
  mocks.fetchEpisodeManualImport.mockResolvedValue(SONARR_SCAN);
  mocks.startMovieManualImport.mockResolvedValue(undefined);
  mocks.startEpisodeManualImport.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function input(overrides: Record<string, unknown> = {}) {
  return { app: "sonarr", queueIds: [101, 102, 103], ...OPTIONS, ...overrides };
}

function nothingRemoved() {
  expect(mocks.removeMovieQueueItem).not.toHaveBeenCalled();
  expect(mocks.removeEpisodeQueueItem).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
}

describe("removeQueueItem authorization", () => {
  it("checks for the admin role only", async () => {
    await removeQueueItem(input());
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never reads or changes the queue", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await removeQueueItem(input())).toEqual({ ok: false, error: DENIED });
    expect(mocks.fetchEpisodeQueue).not.toHaveBeenCalled();
    expect(mocks.fetchMovieQueue).not.toHaveBeenCalled();
    nothingRemoved();
  });

  it("rejects a signed-out caller (401) and never calls Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    expect(await removeQueueItem(input({ app: "radarr", queueIds: [7] }))).toEqual({ ok: false, error: DENIED });
    expect(mocks.fetchMovieQueue).not.toHaveBeenCalled();
    nothingRemoved();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(removeQueueItem(input())).rejects.toThrow("database down");
    nothingRemoved();
  });
});

describe("removeQueueItem input validation", () => {
  it.each([
    ["extra keys", input({ downloadUrl: "http://x" })],
    ["the old single queueId key", { app: "sonarr", queueId: 101, ...OPTIONS }],
    ["an unknown app", input({ app: "lidarr" })],
    ["an empty id list", input({ queueIds: [] })],
    ["more than 1000 ids", input({ queueIds: Array.from({ length: 1001 }, (_, i) => i + 1) })],
    ["a zero id", input({ queueIds: [0] })],
    ["a negative id", input({ queueIds: [-3] })],
    ["a string id", input({ queueIds: ["101"] })],
    ["a fractional id", input({ queueIds: [1.5] })],
    ["ids that are not a list", input({ queueIds: 101 })],
    ["a string flag", input({ blocklist: "true" })],
    ["a missing flag", { app: "sonarr", queueIds: [101], removeFromClient: true, blocklist: false }],
    ["not an object", "sonarr"],
  ])("rejects %s without reading or changing the queue", async (_label, value) => {
    expect(await removeQueueItem(value)).toEqual({ ok: false, error: "Invalid change." });
    expect(mocks.fetchEpisodeQueue).not.toHaveBeenCalled();
    expect(mocks.fetchMovieQueue).not.toHaveBeenCalled();
    nothingRemoved();
  });
});

describe("removeQueueItem routing and results", () => {
  it("removes a Radarr movie by its queued id, then refreshes", async () => {
    expect(
      await removeQueueItem(input({ app: "radarr", queueIds: [7], blocklist: true, skipRedownload: true })),
    ).toEqual({ ok: true });
    expect(mocks.removeMovieQueueItem).toHaveBeenCalledWith(7, {
      removeFromClient: true,
      blocklist: true,
      skipRedownload: true,
    });
    expect(mocks.removeEpisodeQueueItem).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("accepts up to 1000 ids, the most a row can hold", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => i + 1);
    mocks.fetchEpisodeQueue.mockResolvedValue(ids.map((id) => ({ id, seriesId: 10, downloadId: "DL" })));

    expect(await removeQueueItem(input({ queueIds: ids }))).toEqual({ ok: true });
    expect(mocks.removeEpisodeQueueItem).toHaveBeenCalledWith(1, OPTIONS);
  });

  it("sends exactly one id upstream for a season pack, even though all its ids are queued", async () => {
    expect(await removeQueueItem(input({ queueIds: [101, 102, 103] }))).toEqual({ ok: true });
    expect(mocks.removeEpisodeQueueItem).toHaveBeenCalledTimes(1);
    expect(mocks.removeEpisodeQueueItem).toHaveBeenCalledWith(101, OPTIONS);
    expect(mocks.removeMovieQueueItem).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("still resolves a pack to the next id when its smallest id has left the queue", async () => {
    mocks.fetchEpisodeQueue.mockResolvedValue([
      { id: 102, seriesId: 10, downloadId: "DL-PACK" },
      { id: 103, seriesId: 10, downloadId: "DL-PACK" },
    ]);

    expect(await removeQueueItem(input({ queueIds: [101, 102, 103] }))).toEqual({ ok: true });
    expect(mocks.removeEpisodeQueueItem).toHaveBeenCalledWith(102, OPTIONS);
  });

  it("uses the first queued id in the order the browser sent them", async () => {
    await removeQueueItem(input({ queueIds: [103, 101] }));
    expect(mocks.removeEpisodeQueueItem).toHaveBeenCalledWith(103, OPTIONS);
  });

  it("reads only the app's own queue, with the nested objects left out", async () => {
    await removeQueueItem(input({ app: "radarr", queueIds: [7] }));
    await removeQueueItem(input({ queueIds: [101] }));

    expect(mocks.fetchMovieQueue).toHaveBeenCalledWith({ includeMovie: false });
    expect(mocks.fetchEpisodeQueue).toHaveBeenCalledWith({ includeSeries: false, includeEpisode: false });
  });

  it("refuses ids that are only in the other app's queue", async () => {
    // 7 is a Radarr item. Asking Sonarr to remove it must not reach Radarr's queue.
    mocks.fetchMovieQueue.mockResolvedValue([{ id: 7, movieId: 70 }]);
    mocks.fetchEpisodeQueue.mockResolvedValue([]);

    expect(await removeQueueItem(input({ app: "sonarr", queueIds: [7] }))).toEqual({
      ok: false,
      error: "That download is no longer in the queue.",
    });
    expect(mocks.fetchMovieQueue).not.toHaveBeenCalled();
    expect(mocks.removeEpisodeQueueItem).not.toHaveBeenCalled();
    expect(mocks.removeMovieQueueItem).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("passes the flags on unchanged; the Arr client decides what skipRedownload sends", async () => {
    await removeQueueItem(input({ blocklist: false, skipRedownload: true }));
    expect(mocks.removeEpisodeQueueItem).toHaveBeenCalledWith(101, {
      removeFromClient: true,
      blocklist: false,
      skipRedownload: true,
    });
  });

  it("says the row is gone and refreshes, when none of its ids is in the queue", async () => {
    expect(await removeQueueItem(input({ queueIds: [999, 1000] }))).toEqual({
      ok: false,
      error: "That download is no longer in the queue.",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.removeEpisodeQueueItem).not.toHaveBeenCalled();
  });

  it("says the app didn't answer when the queue read fails, and removes nothing", async () => {
    mocks.fetchEpisodeQueue.mockRejectedValue(new ArrRequestError("Sonarr queue request failed: HTTP 500", "http", 500));

    expect(await removeQueueItem(input())).toEqual({ ok: false, error: "Sonarr didn't answer. Nothing was removed." });
    expect(console.error).toHaveBeenCalledWith("Queue remove: Sonarr queue request failed: HTTP 500");
    nothingRemoved();
  });

  it("says the app didn't accept a 4xx, names it, logs only the safe message, and does not refresh", async () => {
    mocks.removeMovieQueueItem.mockRejectedValue(
      new ArrRequestError("Radarr queue remove request failed: HTTP 404", "http", 404),
    );

    expect(await removeQueueItem(input({ app: "radarr", queueIds: [7] }))).toEqual({
      ok: false,
      error: "Radarr didn't accept it. Try again.",
    });
    expect(console.error).toHaveBeenCalledWith("Queue remove: Radarr queue remove request failed: HTTP 404");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says Sonarr didn't confirm a timeout, and that the download may have been removed", async () => {
    mocks.removeEpisodeQueueItem.mockRejectedValue(
      new ArrRequestError("Sonarr queue remove request failed: timed out", "timeout"),
    );

    expect(await removeQueueItem(input())).toEqual({
      ok: false,
      error: "Sonarr didn't confirm it. It may still have been removed, so check the queue.",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says Radarr didn't confirm a 5xx, since it may have been done", async () => {
    mocks.removeMovieQueueItem.mockRejectedValue(
      new ArrRequestError("Radarr queue remove request failed: HTTP 500", "http", 500),
    );

    expect(await removeQueueItem(input({ app: "radarr", queueIds: [7] }))).toEqual({
      ok: false,
      error: "Radarr didn't confirm it. It may still have been removed, so check the queue.",
    });
  });

  it("rethrows errors that are not Arr request failures", async () => {
    mocks.removeEpisodeQueueItem.mockRejectedValue(new Error("bug"));

    await expect(removeQueueItem(input())).rejects.toThrow("bug");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

function loadInput(overrides: Record<string, unknown> = {}) {
  return { app: "sonarr", queueIds: [101, 102], ...overrides };
}

function forceInput(overrides: Record<string, unknown> = {}) {
  return { app: "sonarr", queueIds: [101, 102], fileIds: [202], ...overrides };
}

function movieLoad() {
  return loadInput({ app: "radarr", queueIds: [7] });
}

function movieForce(fileIds: number[]) {
  return forceInput({ app: "radarr", queueIds: [7], fileIds });
}

function noImportRead() {
  expect(mocks.fetchMovieManualImport).not.toHaveBeenCalled();
  expect(mocks.fetchEpisodeManualImport).not.toHaveBeenCalled();
}

function nothingImported() {
  expect(mocks.startMovieManualImport).not.toHaveBeenCalled();
  expect(mocks.startEpisodeManualImport).not.toHaveBeenCalled();
}

describe("loadForceImport and forceImportQueueItem authorization", () => {
  it("checks for the admin role in both actions", async () => {
    await loadForceImport(movieLoad());
    await forceImportQueueItem(movieForce([101]));
    expect(mocks.requireRole).toHaveBeenCalledTimes(2);
    expect(mocks.requireRole).toHaveBeenNthCalledWith(1, "admin");
    expect(mocks.requireRole).toHaveBeenNthCalledWith(2, "admin");
  });

  it("denies a requester in loadForceImport without reading any queue or scan", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await loadForceImport(movieLoad())).toEqual({ ok: false, error: DENIED_IMPORT });
    expect(mocks.fetchMovieQueue).not.toHaveBeenCalled();
    expect(mocks.fetchEpisodeQueue).not.toHaveBeenCalled();
    noImportRead();
  });

  it("denies a requester in forceImportQueueItem without reading or sending anything", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await forceImportQueueItem(movieForce([101]))).toEqual({ ok: false, error: DENIED_IMPORT });
    expect(mocks.fetchMovieQueue).not.toHaveBeenCalled();
    noImportRead();
    nothingImported();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("denies a signed-out caller (401) without calling Radarr or Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    expect(await forceImportQueueItem(movieForce([101]))).toEqual({ ok: false, error: DENIED_IMPORT });
    expect(await loadForceImport(movieLoad())).toEqual({ ok: false, error: DENIED_IMPORT });
    expect(mocks.fetchMovieQueue).not.toHaveBeenCalled();
    noImportRead();
    nothingImported();
  });

  it("rethrows errors from the role check", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(loadForceImport(movieLoad())).rejects.toThrow("database down");
    await expect(forceImportQueueItem(movieForce([101]))).rejects.toThrow("database down");
    noImportRead();
    nothingImported();
  });
});

describe("loadForceImport and forceImportQueueItem input validation", () => {
  it.each([
    ["extra keys", loadInput({ path: "/etc/passwd" })],
    ["an unknown app", loadInput({ app: "lidarr" })],
    ["an empty id list", loadInput({ queueIds: [] })],
    ["more than 1000 ids", loadInput({ queueIds: Array.from({ length: 1001 }, (_, i) => i + 1) })],
    ["a zero id", loadInput({ queueIds: [0] })],
    ["a string id", loadInput({ queueIds: ["101"] })],
    ["file ids in the load", loadInput({ fileIds: [1] })],
    ["not an object", "sonarr"],
  ])("loadForceImport rejects %s without reading anything", async (_label, value) => {
    expect(await loadForceImport(value)).toEqual({ ok: false, error: "Invalid change." });
    expect(mocks.fetchEpisodeQueue).not.toHaveBeenCalled();
    expect(mocks.fetchMovieQueue).not.toHaveBeenCalled();
    noImportRead();
  });

  it.each([
    ["a path sent by the browser", forceInput({ path: "/etc/passwd" })],
    ["a download id sent by the browser", forceInput({ downloadId: "X" })],
    ["no file ids", forceInput({ fileIds: [] })],
    ["a missing file id list", { app: "sonarr", queueIds: [101] }],
    ["more than 500 file ids", forceInput({ fileIds: Array.from({ length: 501 }, (_, i) => i + 1) })],
    ["a zero file id", forceInput({ fileIds: [0] })],
    ["a string file id", forceInput({ fileIds: ["202"] })],
    ["a fractional file id", forceInput({ fileIds: [2.5] })],
    ["file ids that are not a list", forceInput({ fileIds: 202 })],
  ])("forceImportQueueItem rejects %s without reading or sending anything", async (_label, value) => {
    expect(await forceImportQueueItem(value)).toEqual({ ok: false, error: "Invalid change." });
    expect(mocks.fetchEpisodeQueue).not.toHaveBeenCalled();
    expect(mocks.fetchMovieQueue).not.toHaveBeenCalled();
    noImportRead();
    nothingImported();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("loadForceImport", () => {
  it("lists the files the scan found, without paths, folder names or download ids", async () => {
    mocks.fetchMovieQueue.mockResolvedValue(STUCK_MOVIE);

    const result = await loadForceImport(movieLoad());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((file) => file.id)).toEqual([101, 102, 103, 104]);
    expect(result.files[0]).toMatchObject({ name: "Alpha.2001.mkv", match: "Alpha (2001)", importable: true });
    expect(JSON.stringify(result)).not.toContain("LEAK");
  });

  it("scans the download id the server read from the queue, with the nested objects left out", async () => {
    mocks.fetchMovieQueue.mockResolvedValue(STUCK_MOVIE);

    await loadForceImport(movieLoad());

    expect(mocks.fetchMovieQueue).toHaveBeenCalledWith({ includeMovie: false });
    expect(mocks.fetchMovieManualImport).toHaveBeenCalledWith("LEAK-DL-ALPHA");
  });

  it("accepts a Sonarr download when any of its items is completed with a warning", async () => {
    mocks.fetchEpisodeQueue.mockResolvedValue(STUCK_PACK);

    const result = await loadForceImport(loadInput());

    expect(result.ok).toBe(true);
    expect(mocks.fetchEpisodeQueue).toHaveBeenCalledWith({ includeSeries: false, includeEpisode: false });
    expect(mocks.fetchEpisodeManualImport).toHaveBeenCalledWith("LEAK-DL-DELTA");
  });

  it("says the row is gone and refreshes when none of its ids is queued, and does not scan", async () => {
    mocks.fetchMovieQueue.mockResolvedValue([]);

    expect(await loadForceImport(movieLoad())).toEqual({ ok: false, error: NO_LONGER });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    noImportRead();
  });

  it("refuses an item that is not completed with a warning, and does not scan or refresh", async () => {
    mocks.fetchMovieQueue.mockResolvedValue([{ ...STUCK_MOVIE[0], status: "downloading", trackedDownloadStatus: "ok" }]);

    expect(await loadForceImport(movieLoad())).toEqual({ ok: false, error: CANNOT_IMPORT });
    noImportRead();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refuses an item with a blank download id", async () => {
    mocks.fetchMovieQueue.mockResolvedValue([{ ...STUCK_MOVIE[0], downloadId: "   " }]);

    expect(await loadForceImport(movieLoad())).toEqual({ ok: false, error: CANNOT_IMPORT });
    noImportRead();
  });

  it("says Radarr didn't answer when the queue read fails, and logs only the safe message", async () => {
    mocks.fetchMovieQueue.mockRejectedValue(new ArrRequestError("Radarr queue request failed: HTTP 500", "http", 500));

    expect(await loadForceImport(movieLoad())).toEqual({ ok: false, error: "Radarr didn't answer. Try again." });
    expect(console.error).toHaveBeenCalledWith("Force import: Radarr queue request failed: HTTP 500");
    noImportRead();
  });

  it("says Sonarr didn't answer when the scan times out", async () => {
    mocks.fetchEpisodeQueue.mockResolvedValue(STUCK_PACK);
    mocks.fetchEpisodeManualImport.mockRejectedValue(
      new ArrRequestError("Sonarr manual import request failed: timed out", "timeout"),
    );

    expect(await loadForceImport(loadInput())).toEqual({ ok: false, error: "Sonarr didn't answer. Try again." });
    expect(console.error).toHaveBeenCalledWith("Force import: Sonarr manual import request failed: timed out");
  });

  it("rethrows errors that are not Arr request failures", async () => {
    mocks.fetchMovieQueue.mockResolvedValue(STUCK_MOVIE);
    mocks.fetchMovieManualImport.mockRejectedValue(new Error("bug"));

    await expect(loadForceImport(movieLoad())).rejects.toThrow("bug");
  });
});

describe("forceImportQueueItem", () => {
  it("imports one Radarr file, built from the server's scan and not from the browser, then refreshes", async () => {
    mocks.fetchMovieQueue.mockResolvedValue(STUCK_MOVIE);

    expect(await forceImportQueueItem(movieForce([101]))).toEqual({ ok: true });

    expect(mocks.fetchMovieManualImport).toHaveBeenCalledWith("LEAK-DL-ALPHA");
    expect(mocks.startMovieManualImport).toHaveBeenCalledTimes(1);
    expect(mocks.startMovieManualImport).toHaveBeenCalledWith([
      {
        path: "/LEAK/downloads/Alpha.2001.mkv",
        folderName: "LEAK-FOLDER",
        movieId: 1,
        quality: RADARR_SCAN[0].quality,
        languages: [{ id: 1, name: "English" }],
        releaseGroup: "LEAK-GROUP",
        indexerFlags: 0,
        downloadId: "LEAK-DL-ALPHA",
      },
    ]);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("imports one Sonarr file with every episode it covers", async () => {
    mocks.fetchEpisodeQueue.mockResolvedValue(STUCK_PACK);

    expect(await forceImportQueueItem(forceInput({ fileIds: [202] }))).toEqual({ ok: true });

    expect(mocks.startEpisodeManualImport).toHaveBeenCalledWith([
      expect.objectContaining({
        path: "/LEAK/downloads/Delta.Show.S01E02-E03.mkv",
        seriesId: 10,
        episodeIds: [1002, 1003],
        releaseType: "multiEpisode",
        downloadId: "LEAK-DL-DELTA",
      }),
    ]);
    expect(mocks.startMovieManualImport).not.toHaveBeenCalled();
  });

  it("imports a file once when its id is sent twice", async () => {
    mocks.fetchMovieQueue.mockResolvedValue(STUCK_MOVIE);

    await forceImportQueueItem(movieForce([101, 101]));

    expect(mocks.startMovieManualImport).toHaveBeenCalledWith([expect.objectContaining({ movieId: 1 })]);
  });

  it("refuses a file the app won't tick, and sends nothing", async () => {
    mocks.fetchMovieQueue.mockResolvedValue(STUCK_MOVIE);

    expect(await forceImportQueueItem(movieForce([103]))).toEqual({
      ok: false,
      error: "One of the ticked files can't be imported.",
    });
    nothingImported();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says the files changed when a ticked id is not in the new scan", async () => {
    mocks.fetchMovieQueue.mockResolvedValue(STUCK_MOVIE);

    expect(await forceImportQueueItem(movieForce([999]))).toEqual({
      ok: false,
      error: "The files in that download changed. Close this and open Force import again.",
    });
    nothingImported();
  });

  it("refuses two Sonarr files for the same episode, and sends nothing", async () => {
    mocks.fetchEpisodeQueue.mockResolvedValue(STUCK_PACK);
    mocks.fetchEpisodeManualImport.mockResolvedValue([...SONARR_SCAN, { ...SONARR_SCAN[0], id: 205 }]);

    expect(await forceImportQueueItem(forceInput({ fileIds: [201, 205] }))).toEqual({
      ok: false,
      error: "Two ticked files are for the same movie or episode. Untick one.",
    });
    nothingImported();
  });

  it("says the row is gone and refreshes when none of its ids is queued, and sends nothing", async () => {
    mocks.fetchMovieQueue.mockResolvedValue([]);

    expect(await forceImportQueueItem(movieForce([101]))).toEqual({ ok: false, error: NO_LONGER });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    noImportRead();
    nothingImported();
  });

  it("refuses a download that is not completed with a warning, and sends nothing", async () => {
    mocks.fetchMovieQueue.mockResolvedValue([{ ...STUCK_MOVIE[0], status: "queued" }]);

    expect(await forceImportQueueItem(movieForce([101]))).toEqual({ ok: false, error: CANNOT_IMPORT });
    nothingImported();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says Radarr didn't answer, and that nothing was imported, when the queue read fails", async () => {
    mocks.fetchMovieQueue.mockRejectedValue(new ArrRequestError("Radarr queue request failed: network error", "network"));

    expect(await forceImportQueueItem(movieForce([101]))).toEqual({
      ok: false,
      error: "Radarr didn't answer. Nothing was imported.",
    });
    expect(console.error).toHaveBeenCalledWith("Force import: Radarr queue request failed: network error");
    nothingImported();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says Sonarr didn't answer, and that nothing was imported, when the scan fails", async () => {
    mocks.fetchEpisodeQueue.mockResolvedValue(STUCK_PACK);
    mocks.fetchEpisodeManualImport.mockRejectedValue(
      new ArrRequestError("Sonarr manual import request failed: HTTP 500", "http", 500),
    );

    expect(await forceImportQueueItem(forceInput({ fileIds: [202] }))).toEqual({
      ok: false,
      error: "Sonarr didn't answer. Nothing was imported.",
    });
    nothingImported();
  });

  it("says Radarr didn't accept a 4xx from the command, logs the safe message, and does not refresh", async () => {
    mocks.fetchMovieQueue.mockResolvedValue(STUCK_MOVIE);
    mocks.startMovieManualImport.mockRejectedValue(
      new ArrRequestError("Radarr manual import command request failed: HTTP 400", "http", 400),
    );

    expect(await forceImportQueueItem(movieForce([101]))).toEqual({
      ok: false,
      error: "Radarr didn't accept it. Try again.",
    });
    expect(console.error).toHaveBeenCalledWith("Force import: Radarr manual import command request failed: HTTP 400");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says Sonarr didn't confirm a timeout on the command, and that the import may have started", async () => {
    mocks.fetchEpisodeQueue.mockResolvedValue(STUCK_PACK);
    mocks.startEpisodeManualImport.mockRejectedValue(
      new ArrRequestError("Sonarr manual import command request failed: timed out", "timeout"),
    );

    expect(await forceImportQueueItem(forceInput({ fileIds: [202] }))).toEqual({
      ok: false,
      error: "Sonarr didn't confirm it. It may still have been started, so check the queue.",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not Arr request failures from the command", async () => {
    mocks.fetchMovieQueue.mockResolvedValue(STUCK_MOVIE);
    mocks.startMovieManualImport.mockRejectedValue(new Error("bug"));

    await expect(forceImportQueueItem(movieForce([101]))).rejects.toThrow("bug");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

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
  { id: 101, seriesId: 10, episodeId: 1001, downloadId: "LEAK-DL-DELTA", status: "completed", trackedDownloadStatus: "warning" },
  { id: 102, seriesId: 10, episodeId: 1002, downloadId: "LEAK-DL-DELTA", status: "downloading", trackedDownloadStatus: "ok" },
];

const READS = [mocks.fetchMovieQueue, mocks.fetchEpisodeQueue, mocks.fetchMovieManualImport, mocks.fetchEpisodeManualImport];
const WRITES = [mocks.removeMovieQueueItem, mocks.removeEpisodeQueueItem, mocks.startMovieManualImport, mocks.startEpisodeManualImport];

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
const queueStuckMovie = () => mocks.fetchMovieQueue.mockResolvedValue(STUCK_MOVIE);
const queueStuckPack = () => mocks.fetchEpisodeQueue.mockResolvedValue(STUCK_PACK);

/** Nothing was read from or sent to Radarr or Sonarr, and nothing refreshed. */
function expectNoUpstream() {
  for (const mock of [...READS, ...WRITES]) expect(mock).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
}

/** Nothing was removed or imported, and nothing refreshed. Reads are allowed. */
function expectNoWrites() {
  for (const mock of WRITES) expect(mock).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
}

describe("authorization", () => {
  type AuthRow = { name: string; call: () => Promise<unknown>; denied: string };

  // One row per action, all admin-only. Each call uses valid input, so only the role check can stop it.
  // 401 and 403 take the same branch in each action, so 403 stands for both.
  const rows: AuthRow[] = [
    { name: "removeQueueItem", call: () => removeQueueItem(input()), denied: "You don't have permission to remove downloads." },
    { name: "loadForceImport", call: () => loadForceImport(movieLoad()), denied: DENIED_IMPORT },
    { name: "forceImportQueueItem", call: () => forceImportQueueItem(movieForce([101])), denied: DENIED_IMPORT },
  ];

  it.each(rows)("$name checks for the admin role only", async ({ call }) => {
    await call();
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it.each(rows)("$name refuses a requester, and reads and sends nothing", async ({ call, denied }) => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await call()).toEqual({ ok: false, error: denied });
    expectNoUpstream();
  });

  it.each(rows)("$name rethrows a role-check error that is not an authorization failure", async ({ call }) => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(call()).rejects.toThrow("database down");
    expectNoUpstream();
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
    expectNoUpstream();
  });
});

describe("removeQueueItem routing and results", () => {
  it("removes a Radarr movie by its queued id with the flags as sent, then refreshes", async () => {
    expect(await removeQueueItem(input({ app: "radarr", queueIds: [7], blocklist: true, skipRedownload: true }))).toEqual({
      ok: true,
    });
    expect(mocks.removeMovieQueueItem).toHaveBeenCalledWith(7, { removeFromClient: true, blocklist: true, skipRedownload: true });
    expect(mocks.removeEpisodeQueueItem).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("passes the flags on unchanged to a Sonarr removal; the Arr client decides what skipRedownload sends", async () => {
    await removeQueueItem(input({ blocklist: false, skipRedownload: true }));
    expect(mocks.removeEpisodeQueueItem).toHaveBeenCalledWith(101, { removeFromClient: true, blocklist: false, skipRedownload: true });
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

  it("says the row is gone and refreshes when none of its ids is in this app's queue, and never reads the other app's queue", async () => {
    // 7 is a Radarr item. Asking Sonarr to remove it must not read or change Radarr's queue.
    expect(await removeQueueItem(input({ app: "sonarr", queueIds: [7] }))).toEqual({ ok: false, error: NO_LONGER });
    expect(mocks.fetchMovieQueue).not.toHaveBeenCalled();
    expect(mocks.removeEpisodeQueueItem).not.toHaveBeenCalled();
    expect(mocks.removeMovieQueueItem).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("removeQueueItem and force import: upstream failures", () => {
  const READ_FAILURES = [
    {
      name: "removeQueueItem, Sonarr's queue read is an HTTP 500",
      fail: mocks.fetchEpisodeQueue,
      error: new ArrRequestError("Sonarr queue request failed: HTTP 500", "http", 500),
      call: () => removeQueueItem(input()),
      message: "Sonarr didn't answer. Nothing was removed.",
      log: "Queue remove: Sonarr queue request failed: HTTP 500",
    },
    {
      name: "loadForceImport, Sonarr's scan times out",
      prepare: queueStuckPack,
      fail: mocks.fetchEpisodeManualImport,
      error: new ArrRequestError("Sonarr manual import request failed: timed out", "timeout"),
      call: () => loadForceImport(loadInput()),
      message: "Sonarr didn't answer. Try again.",
      log: "Force import: Sonarr manual import request failed: timed out",
    },
    {
      name: "loadForceImport, Radarr's queue read is an HTTP 500",
      fail: mocks.fetchMovieQueue,
      error: new ArrRequestError("Radarr queue request failed: HTTP 500", "http", 500),
      call: () => loadForceImport(movieLoad()),
      message: "Radarr didn't answer. Try again.",
      log: "Force import: Radarr queue request failed: HTTP 500",
    },
    {
      name: "forceImportQueueItem, Radarr's queue read has a network error",
      fail: mocks.fetchMovieQueue,
      error: new ArrRequestError("Radarr queue request failed: network error", "network"),
      call: () => forceImportQueueItem(movieForce([101])),
      message: "Radarr didn't answer. Nothing was imported.",
      log: "Force import: Radarr queue request failed: network error",
    },
    {
      name: "forceImportQueueItem, Sonarr's scan is an HTTP 500",
      prepare: queueStuckPack,
      fail: mocks.fetchEpisodeManualImport,
      error: new ArrRequestError("Sonarr manual import request failed: HTTP 500", "http", 500),
      call: () => forceImportQueueItem(forceInput({ fileIds: [202] })),
      message: "Sonarr didn't answer. Nothing was imported.",
      log: "Force import: Sonarr manual import request failed: HTTP 500",
    },
  ];

  it.each(READ_FAILURES)("$name says the app didn't answer, logs only the safe message, and sends nothing", async ({ prepare, fail, error, call, message, log }) => {
    prepare?.();
    fail.mockRejectedValue(error);

    expect(await call()).toEqual({ ok: false, error: message });
    expect(console.error).toHaveBeenCalledWith(log);
    expectNoWrites();
    // A failed queue read must stop the action before it scans for files.
    if (fail === mocks.fetchMovieQueue || fail === mocks.fetchEpisodeQueue) {
      expect(mocks.fetchMovieManualImport).not.toHaveBeenCalled();
      expect(mocks.fetchEpisodeManualImport).not.toHaveBeenCalled();
    }
  });

  const WRITE_FAILURES = [
    {
      name: "removeQueueItem, Radarr answers 404",
      fail: mocks.removeMovieQueueItem,
      error: new ArrRequestError("Radarr queue remove request failed: HTTP 404", "http", 404),
      call: () => removeQueueItem(input({ app: "radarr", queueIds: [7] })),
      message: "Radarr didn't accept it. Try again.",
      log: "Queue remove: Radarr queue remove request failed: HTTP 404",
    },
    {
      name: "removeQueueItem, Radarr answers 500",
      fail: mocks.removeMovieQueueItem,
      error: new ArrRequestError("Radarr queue remove request failed: HTTP 500", "http", 500),
      call: () => removeQueueItem(input({ app: "radarr", queueIds: [7] })),
      message: "Radarr didn't confirm it. It may still have been removed, so check the queue.",
      log: "Queue remove: Radarr queue remove request failed: HTTP 500",
    },
    {
      name: "removeQueueItem, Sonarr times out",
      fail: mocks.removeEpisodeQueueItem,
      error: new ArrRequestError("Sonarr queue remove request failed: timed out", "timeout"),
      call: () => removeQueueItem(input()),
      message: "Sonarr didn't confirm it. It may still have been removed, so check the queue.",
      log: "Queue remove: Sonarr queue remove request failed: timed out",
    },
    {
      name: "forceImportQueueItem, Radarr answers 400",
      prepare: queueStuckMovie,
      fail: mocks.startMovieManualImport,
      error: new ArrRequestError("Radarr manual import command request failed: HTTP 400", "http", 400),
      call: () => forceImportQueueItem(movieForce([101])),
      message: "Radarr didn't accept it. Try again.",
      log: "Force import: Radarr manual import command request failed: HTTP 400",
    },
    {
      name: "forceImportQueueItem, Sonarr times out on the command",
      prepare: queueStuckPack,
      fail: mocks.startEpisodeManualImport,
      error: new ArrRequestError("Sonarr manual import command request failed: timed out", "timeout"),
      call: () => forceImportQueueItem(forceInput({ fileIds: [202] })),
      message: "Sonarr didn't confirm it. It may still have been started, so check the queue.",
      log: "Force import: Sonarr manual import command request failed: timed out",
    },
  ];

  // A 4xx means the app refused the write. Any other failure, including a timeout, might still have happened, so the
  // message says so and the user checks before retrying. Refresh is not called in either case.
  it.each(WRITE_FAILURES)("$name says the write failed, logs only the safe message, and does not refresh", async ({ prepare, fail, error, call, message, log }) => {
    prepare?.();
    fail.mockRejectedValue(error);

    expect(await call()).toEqual({ ok: false, error: message });
    expect(console.error).toHaveBeenCalledWith(log);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  const RETHROWS = [
    { name: "removeQueueItem", fail: mocks.removeEpisodeQueueItem, call: () => removeQueueItem(input()) },
    { name: "loadForceImport", prepare: queueStuckMovie, fail: mocks.fetchMovieManualImport, call: () => loadForceImport(movieLoad()) },
    { name: "forceImportQueueItem", prepare: queueStuckMovie, fail: mocks.startMovieManualImport, call: () => forceImportQueueItem(movieForce([101])) },
  ];

  it.each(RETHROWS)("$name rethrows an error that is not an Arr request failure", async ({ prepare, fail, call }) => {
    prepare?.();
    fail.mockRejectedValue(new Error("bug"));

    await expect(call()).rejects.toThrow("bug");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("loadForceImport input validation", () => {
  it.each([
    ["extra keys", loadInput({ path: "/etc/passwd" })],
    ["an unknown app", loadInput({ app: "lidarr" })],
    ["an empty id list", loadInput({ queueIds: [] })],
    ["more than 1000 ids", loadInput({ queueIds: Array.from({ length: 1001 }, (_, i) => i + 1) })],
    ["a zero id", loadInput({ queueIds: [0] })],
    ["a string id", loadInput({ queueIds: ["101"] })],
    ["file ids in the load", loadInput({ fileIds: [1] })],
    ["not an object", "sonarr"],
  ])("rejects %s without reading anything", async (_label, value) => {
    expect(await loadForceImport(value)).toEqual({ ok: false, error: "Invalid change." });
    expectNoUpstream();
  });
});

describe("forceImportQueueItem input validation", () => {
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
  ])("rejects %s without reading or sending anything", async (_label, value) => {
    expect(await forceImportQueueItem(value)).toEqual({ ok: false, error: "Invalid change." });
    expectNoUpstream();
  });
});

describe("loadForceImport", () => {
  it("lists the files the scan found, without paths, folder names or download ids", async () => {
    queueStuckMovie();

    const result = await loadForceImport(movieLoad());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((file) => file.id)).toEqual([101, 102, 103, 104]);
    expect(result.files[0]).toMatchObject({ name: "Alpha.2001.mkv", match: "Alpha (2001)", importable: true });
    expect(JSON.stringify(result)).not.toContain("LEAK");
  });

  it("scans the download id the server read from the queue, with the nested objects left out", async () => {
    queueStuckMovie();

    await loadForceImport(movieLoad());

    expect(mocks.fetchMovieQueue).toHaveBeenCalledWith({ includeMovie: false });
    expect(mocks.fetchMovieManualImport).toHaveBeenCalledWith("LEAK-DL-ALPHA");
  });

  it("accepts a Sonarr download when any of its items is completed with a warning", async () => {
    queueStuckPack();

    const result = await loadForceImport(loadInput());

    expect(result.ok).toBe(true);
    expect(mocks.fetchEpisodeQueue).toHaveBeenCalledWith({ includeSeries: false, includeEpisode: false });
    expect(mocks.fetchEpisodeManualImport).toHaveBeenCalledWith("LEAK-DL-DELTA");
  });
});

describe("forceImportQueueItem", () => {
  it("imports one Radarr file, built from the server's scan and not from the browser, then refreshes", async () => {
    queueStuckMovie();

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
    queueStuckPack();

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
    queueStuckMovie();

    await forceImportQueueItem(movieForce([101, 101]));

    expect(mocks.startMovieManualImport).toHaveBeenCalledWith([expect.objectContaining({ movieId: 1 })]);
  });

  // Each refusal comes from a different pick check, and each sends nothing and does not refresh.
  it.each([
    {
      name: "a file the app won't tick",
      prepare: queueStuckMovie,
      call: () => forceImportQueueItem(movieForce([103])),
      error: "One of the ticked files can't be imported.",
    },
    {
      name: "an id that is not in the new scan",
      prepare: queueStuckMovie,
      call: () => forceImportQueueItem(movieForce([999])),
      error: "The files in that download changed. Close this and open Force import again.",
    },
    {
      name: "two files for the same episode",
      prepare: () => {
        queueStuckPack();
        mocks.fetchEpisodeManualImport.mockResolvedValue([...SONARR_SCAN, { ...SONARR_SCAN[0], id: 205 }]);
      },
      call: () => forceImportQueueItem(forceInput({ fileIds: [201, 205] })),
      error: "Two ticked files are for the same movie or episode. Untick one.",
    },
  ])("refuses $name, and sends nothing", async ({ prepare, call, error }) => {
    prepare?.();

    expect(await call()).toEqual({ ok: false, error });
    expectNoWrites();
  });
});

// The queue gate both actions share: the row's download must still be queued, and completed with a warning.
// A refusal here reads no scan and sends nothing.
describe("loadForceImport and forceImportQueueItem: the queue gate", () => {
  const IMPORT_ACTIONS = [
    { action: "loadForceImport", call: () => loadForceImport(movieLoad()) },
    { action: "forceImportQueueItem", call: () => forceImportQueueItem(movieForce([101])) },
  ];
  const GATES: { label: string; queue: MovieQueueItem[]; error: string; refreshes: number }[] = [
    { label: "none of its ids is queued", queue: [], error: NO_LONGER, refreshes: 1 },
    {
      label: "its download is not completed with a warning",
      queue: [{ ...STUCK_MOVIE[0], status: "downloading", trackedDownloadStatus: "ok" }],
      error: CANNOT_IMPORT,
      refreshes: 0,
    },
    { label: "its download id is blank", queue: [{ ...STUCK_MOVIE[0], downloadId: "   " }], error: CANNOT_IMPORT, refreshes: 0 },
  ];

  it.each(IMPORT_ACTIONS.flatMap((action) => GATES.map((gate) => ({ ...action, ...gate }))))(
    "$action refuses when $label, without scanning or sending",
    async ({ call, queue, error, refreshes }) => {
      mocks.fetchMovieQueue.mockResolvedValue(queue);

      expect(await call()).toEqual({ ok: false, error });
      expect(mocks.refresh).toHaveBeenCalledTimes(refreshes);
      for (const mock of [mocks.fetchMovieManualImport, mocks.fetchEpisodeManualImport, ...WRITES]) {
        expect(mock).not.toHaveBeenCalled();
      }
    },
  );
});

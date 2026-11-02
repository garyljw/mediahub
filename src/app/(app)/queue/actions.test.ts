import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";
import type { components as RadarrComponents } from "@/server/arr/generated/radarr";
import type { components as SonarrComponents } from "@/server/arr/generated/sonarr";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  fetchMovieQueue: vi.fn(),
  fetchEpisodeQueue: vi.fn(),
  removeMovieQueueItem: vi.fn(),
  removeEpisodeQueueItem: vi.fn(),
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

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import { AuthzError } from "@/server/authz";
import { removeQueueItem } from "./actions";

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.fetchMovieQueue.mockResolvedValue(MOVIES);
  mocks.fetchEpisodeQueue.mockResolvedValue(PACK);
  mocks.removeMovieQueueItem.mockResolvedValue(undefined);
  mocks.removeEpisodeQueueItem.mockResolvedValue(undefined);
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

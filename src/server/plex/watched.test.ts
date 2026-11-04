import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlexRequestError } from "./errors";

const mocks = vi.hoisted(() => ({
  getPlexDataConnection: vi.fn(),
  getServerIdentity: vi.fn(),
  getLibrarySections: vi.fn(),
  getSectionItems: vi.fn(),
  getShowEpisodes: vi.fn(),
}));

vi.mock("./data-connection", () => ({ getPlexDataConnection: mocks.getPlexDataConnection }));
vi.mock("./server", () => ({
  getServerIdentity: mocks.getServerIdentity,
  getLibrarySections: mocks.getLibrarySections,
  getSectionItems: mocks.getSectionItems,
  getShowEpisodes: mocks.getShowEpisodes,
}));

import { getSeriesEpisodeWatched, getWatchedIndex, resetWatchedCache } from "./watched";

const TOKEN = "fake-plex-data-token-0123456789abcdef";
const SERVER_ID = "fakefriendmachine0123456789abcdef0123";
const CONNECTION = {
  url: "https://192-168-10-5.fakehash.plex.direct:32400",
  pinAddress: "192.168.10.5",
  token: TOKEN,
  serverId: SERVER_ID,
  serverName: "Fake Friend Server",
};

const SECTIONS = [
  { key: "1", type: "movie", title: "Films" },
  { key: "2", type: "show", title: "TV" },
  { key: "3", type: "artist", title: "Music" },
];

function useConnection(connection: typeof CONNECTION | null = CONNECTION) {
  mocks.getPlexDataConnection.mockReturnValue(connection);
}

function useHealthyServer() {
  mocks.getServerIdentity.mockResolvedValue(SERVER_ID);
  mocks.getLibrarySections.mockResolvedValue(SECTIONS);
  mocks.getSectionItems.mockImplementation(async (_conn: unknown, _token: string, key: string) =>
    key === "1"
      ? [{ guids: ["tmdb://900001"], viewCount: 1, viewOffset: 0, leafCount: 0, viewedLeafCount: 0, ratingKey: null }]
      : [
          {
            guids: ["tvdb://100001"],
            viewCount: 0,
            viewOffset: 0,
            leafCount: 10,
            viewedLeafCount: 4,
            ratingKey: "2001",
          },
        ],
  );
}

beforeEach(() => {
  resetWatchedCache();
  useConnection();
  useHealthyServer();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("getWatchedIndex: not set up", () => {
  it("returns null with no Plex call when there is no data connection", async () => {
    useConnection(null);
    await expect(getWatchedIndex()).resolves.toBeNull();
    expect(mocks.getServerIdentity).not.toHaveBeenCalled();
    expect(mocks.getSectionItems).not.toHaveBeenCalled();
  });
});

describe("getWatchedIndex: the server check", () => {
  it("fails, with no section call, when the address answers as a different server", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getServerIdentity.mockResolvedValue("someone-else-machine-id");

    await expect(getWatchedIndex()).resolves.toBe("failed");
    expect(mocks.getLibrarySections).not.toHaveBeenCalled();
    expect(mocks.getSectionItems).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Plex watched: server identity did not match");
  });

  it("checks the identity before any call that carries the token", async () => {
    const order: string[] = [];
    mocks.getServerIdentity.mockImplementation(async () => {
      order.push("identity");
      return SERVER_ID;
    });
    mocks.getLibrarySections.mockImplementation(async () => {
      order.push("sections");
      return SECTIONS;
    });
    await getWatchedIndex();
    expect(order).toEqual(["identity", "sections"]);
  });
});

describe("getWatchedIndex: loading", () => {
  it("loads movie and show sections only, and returns the index", async () => {
    const index = await getWatchedIndex();
    expect(index).not.toBe("failed");
    expect(index).not.toBeNull();
    if (index === null || index === "failed") throw new Error("expected an index");

    expect(index.movies.get(900001)).toBe("watched");
    expect(index.series.get(100001)).toBe("partial");

    const keys = mocks.getSectionItems.mock.calls.map((call) => call[2]).sort();
    expect(keys).toEqual(["1", "2"]);
  });

  it("gives each section call the connection's token and its own server connection", async () => {
    await getWatchedIndex();
    for (const call of mocks.getSectionItems.mock.calls) {
      expect(call[0]).toEqual({ url: CONNECTION.url, pinAddress: CONNECTION.pinAddress });
      expect(call[1]).toBe(TOKEN);
    }
  });
});

describe("getWatchedIndex: the cache", () => {
  it("serves a second call within 60 seconds with no Plex call", async () => {
    await getWatchedIndex();
    await getWatchedIndex();
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.getSectionItems).toHaveBeenCalledTimes(2);
  });

  it("refetches after 60 seconds", async () => {
    vi.useFakeTimers();
    await getWatchedIndex();
    vi.advanceTimersByTime(59_000);
    await getWatchedIndex();
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    await getWatchedIndex();
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(2);
  });

  it("refetches when the address changes", async () => {
    await getWatchedIndex();
    useConnection({ ...CONNECTION, url: "https://192-168-10-9.fakehash.plex.direct:32400", pinAddress: "192.168.10.9" });
    await getWatchedIndex();
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(2);
  });

  it("refetches when the token changes", async () => {
    await getWatchedIndex();
    useConnection({ ...CONNECTION, token: "another-fake-plex-token-0123456789" });
    await getWatchedIndex();
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(2);
  });

  it("checks the identity with a short timeout", async () => {
    await getWatchedIndex();
    expect(mocks.getServerIdentity).toHaveBeenCalledWith(expect.anything(), { timeoutMs: 3_000 });
  });

  it("shares one load between two concurrent callers", async () => {
    const [first, second] = await Promise.all([getWatchedIndex(), getWatchedIndex()]);
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("keeps a separate entry per Plex user", async () => {
    await getWatchedIndex("default");
    await getWatchedIndex("someone");
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(2);
  });
});

describe("getWatchedIndex: failures", () => {
  it("reports a Plex request failure as failed, logs only its message, and retries after 30 seconds", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getServerIdentity.mockRejectedValueOnce(new PlexRequestError("Plex server identity request failed: timed out", "timeout"));

    await expect(getWatchedIndex()).resolves.toBe("failed");
    expect(log).toHaveBeenCalledWith("Plex watched: Plex server identity request failed: timed out");

    // Within 30 s the failure is reused, so a dead Plex doesn't hold up every Home visit.
    vi.advanceTimersByTime(29_000);
    await expect(getWatchedIndex()).resolves.toBe("failed");
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    await expect(getWatchedIndex()).resolves.not.toBe("failed");
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(2);
  });

  it("rethrows an error that is not a Plex request failure", async () => {
    mocks.getLibrarySections.mockRejectedValueOnce(new Error("database is locked"));
    await expect(getWatchedIndex()).rejects.toThrow("database is locked");
  });
});

describe("getSeriesEpisodeWatched", () => {
  const EPISODE_A = { guids: ["tvdb://100101"], season: 1, episode: 1, viewCount: 1, viewOffset: 0 };
  const EPISODE_B = { guids: ["tvdb://100102"], season: 1, episode: 2, viewCount: 0, viewOffset: 0 };

  beforeEach(() => {
    mocks.getShowEpisodes.mockResolvedValue([EPISODE_A]);
  });

  it("returns null with no Plex call when there is no data connection", async () => {
    useConnection(null);
    await expect(getSeriesEpisodeWatched(100001)).resolves.toBeNull();
    expect(mocks.getServerIdentity).not.toHaveBeenCalled();
    expect(mocks.getShowEpisodes).not.toHaveBeenCalled();
  });

  it("returns null, with no identity or episode call, when the series is not in Plex", async () => {
    await getWatchedIndex();
    mocks.getServerIdentity.mockClear();

    await expect(getSeriesEpisodeWatched(999999)).resolves.toBeNull();
    expect(mocks.getServerIdentity).not.toHaveBeenCalled();
    expect(mocks.getShowEpisodes).not.toHaveBeenCalled();
  });

  it("returns failed, with no episode call, when the section index failed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getServerIdentity.mockResolvedValue("someone-else-machine-id");

    await expect(getSeriesEpisodeWatched(100001)).resolves.toBe("failed");
    expect(mocks.getShowEpisodes).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Plex watched: server identity did not match");
  });

  it("checks the identity again and never loads episodes from a different server", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await getWatchedIndex();
    mocks.getServerIdentity.mockResolvedValue("someone-else-machine-id");

    await expect(getSeriesEpisodeWatched(100001)).resolves.toBe("failed");
    expect(mocks.getShowEpisodes).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Plex episodes: server identity did not match");
  });

  it("loads every show that has the series' tvdb id, and flattens the episodes", async () => {
    mocks.getSectionItems.mockImplementation(async (_conn: unknown, _token: string, key: string) =>
      key === "2"
        ? [
            { guids: ["tvdb://100005"], viewCount: 0, viewOffset: 0, leafCount: 2, viewedLeafCount: 0, ratingKey: "7001" },
            { guids: ["tvdb://100005"], viewCount: 0, viewOffset: 0, leafCount: 2, viewedLeafCount: 0, ratingKey: "7002" },
          ]
        : [],
    );
    mocks.getShowEpisodes.mockImplementation(async (_conn: unknown, _token: string, key: string) =>
      key === "7001" ? [EPISODE_A] : [EPISODE_B],
    );

    await expect(getSeriesEpisodeWatched(100005)).resolves.toEqual([EPISODE_A, EPISODE_B]);
    expect(mocks.getShowEpisodes.mock.calls.map((call) => call[2])).toEqual(["7001", "7002"]);
    for (const call of mocks.getShowEpisodes.mock.calls) {
      expect(call[0]).toEqual({ url: CONNECTION.url, pinAddress: CONNECTION.pinAddress });
      expect(call[1]).toBe(TOKEN);
    }
  });

  it("returns failed for a Plex request failure, logs only its message, and never the token or address", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getShowEpisodes.mockRejectedValue(new PlexRequestError("Plex show episodes request failed: timed out", "timeout"));

    await expect(getSeriesEpisodeWatched(100001)).resolves.toBe("failed");
    expect(log).toHaveBeenCalledWith("Plex episodes: Plex show episodes request failed: timed out");
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(CONNECTION.url);
  });

  it("rethrows an error that is not a Plex request failure", async () => {
    mocks.getShowEpisodes.mockRejectedValue(new Error("database is locked"));
    await expect(getSeriesEpisodeWatched(100001)).rejects.toThrow("database is locked");
  });
});

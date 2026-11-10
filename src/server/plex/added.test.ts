import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlexRequestError } from "./errors";

const mocks = vi.hoisted(() => ({
  getPlexDataConnection: vi.fn(),
  getServerIdentity: vi.fn(),
  getLibrarySections: vi.fn(),
  getSectionItems: vi.fn(),
  getSectionEpisodeAdded: vi.fn(),
}));

vi.mock("./data-connection", () => ({ getPlexDataConnection: mocks.getPlexDataConnection }));
vi.mock("./server", () => ({
  getServerIdentity: mocks.getServerIdentity,
  getLibrarySections: mocks.getLibrarySections,
  getSectionItems: mocks.getSectionItems,
  getSectionEpisodeAdded: mocks.getSectionEpisodeAdded,
}));

import { getPlexAddedIndex, resetPlexAddedCache } from "./added";

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

function useHealthyServer() {
  mocks.getServerIdentity.mockResolvedValue(SERVER_ID);
  mocks.getLibrarySections.mockResolvedValue(SECTIONS);
  mocks.getSectionItems.mockImplementation(async (_conn: unknown, _token: string, key: string) =>
    key === "1"
      ? [{ guids: ["tmdb://900001"], viewCount: 0, viewOffset: 0, leafCount: 0, viewedLeafCount: 0, ratingKey: "1001", addedAt: 1700000000 }]
      : [{ guids: ["tvdb://100001"], viewCount: 0, viewOffset: 0, leafCount: 3, viewedLeafCount: 0, ratingKey: "2001", addedAt: 1600000000 }],
  );
  mocks.getSectionEpisodeAdded.mockResolvedValue([{ showKey: "2001", addedAt: 1710000000 }]);
}

beforeEach(() => {
  resetPlexAddedCache();
  mocks.getPlexDataConnection.mockReturnValue(CONNECTION);
  useHealthyServer();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("getPlexAddedIndex: the server check", () => {
  it("fails, with no section call, when the address answers as a different server", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getServerIdentity.mockResolvedValue("someone-else-machine-id");

    await expect(getPlexAddedIndex()).resolves.toBe("failed");
    expect(mocks.getLibrarySections).not.toHaveBeenCalled();
    expect(mocks.getSectionItems).not.toHaveBeenCalled();
    expect(mocks.getSectionEpisodeAdded).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Plex added: server identity did not match");
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
    await getPlexAddedIndex();
    expect(order).toEqual(["identity", "sections"]);
  });
});

describe("getPlexAddedIndex: loading", () => {
  it("reads episodes for show sections only", async () => {
    const index = await getPlexAddedIndex();
    expect(index).not.toBe("failed");
    expect(mocks.getSectionEpisodeAdded.mock.calls.map((call) => call[2])).toEqual(["2"]);
    expect(mocks.getSectionEpisodeAdded.mock.calls[0][1]).toBe(TOKEN);
  });

  it("returns dates keyed by TMDB id for movies and TVDB id for series, with the newest episode for a show", async () => {
    const index = await getPlexAddedIndex();
    if (index === null || index === "failed") throw new Error("expected an index");
    expect(index.movies.get(900001)).toBe(new Date(1700000000 * 1000).toISOString());
    expect(index.series.get(100001)).toBe(new Date(1710000000 * 1000).toISOString());
  });
});

describe("getPlexAddedIndex: the cache", () => {
  it("serves a second call within five minutes with no Plex call", async () => {
    await getPlexAddedIndex();
    await getPlexAddedIndex();
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.getSectionItems).toHaveBeenCalledTimes(2);
  });

  it("refetches after five minutes", async () => {
    vi.useFakeTimers();
    await getPlexAddedIndex();
    vi.advanceTimersByTime(4 * 60_000 + 59_000);
    await getPlexAddedIndex();
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    await getPlexAddedIndex();
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(2);
  });
});

describe("getPlexAddedIndex: failures and no connection", () => {
  it("returns null with no Plex call when there is no data connection", async () => {
    mocks.getPlexDataConnection.mockReturnValue(null);
    await expect(getPlexAddedIndex()).resolves.toBeNull();
    expect(mocks.getServerIdentity).not.toHaveBeenCalled();
  });

  it("reports a Plex request failure as failed and logs only its message, never the token or address", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getSectionEpisodeAdded.mockRejectedValue(new PlexRequestError("Plex show episodes added request failed: timed out", "timeout"));

    await expect(getPlexAddedIndex()).resolves.toBe("failed");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Plex added: Plex show episodes added request failed: timed out");
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(CONNECTION.url);
  });
});

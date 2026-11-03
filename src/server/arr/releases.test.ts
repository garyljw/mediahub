import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as RadarrComponents } from "./generated/radarr";
import releaseFixture from "./__fixtures__/radarr-releases.json";
import { ARR_TIMEOUT_MS, ArrRequestError } from "./request";
import { createReleaseCache, type ReleaseCache } from "./release-cache";
import { MAX_CACHED_RELEASES, RELEASE_TTL_MS } from "./release-cache";

type ReleaseResource = RadarrComponents["schemas"]["ReleaseResource"];

const releases = releaseFixture as ReleaseResource[];

const { FAKE_KEY, fakeConnections, testCache } = vi.hoisted(() => {
  const key = "fake-api-key-0123456789abcdefghi"; // 32 chars, not a real secret
  return {
    FAKE_KEY: key,
    fakeConnections: {
      radarr: { url: "http://radarr.test:7878", apiKey: key },
      sonarr: { url: "http://sonarr.test:8989", apiKey: key },
    },
    // Each test gets a fresh cache, so tokens never leak between tests.
    testCache: { current: null as ReleaseCache | null },
  };
});

vi.mock("@/server/settings/connections", () => ({
  getConnection: (app: "radarr" | "sonarr") => fakeConnections[app],
}));

vi.mock("./release-cache", async () => {
  const actual = await vi.importActual<typeof import("./release-cache")>("./release-cache");
  return {
    ...actual,
    get releaseCache() {
      if (testCache.current === null) throw new Error("test cache not set up");
      return testCache.current;
    },
  };
});

import { ReleaseGrabError, grabRelease, searchReleases, toReleaseRows, episodesLabel, RELEASE_GRAB_TIMEOUT_MS, RELEASE_SEARCH_TIMEOUT_MS, MAX_RELEASES_PER_PROTOCOL, type ReleaseLike, type ReleaseRow } from "./releases";

const ALLOWED_KEYS = [
  "ageHours",
  "approved",
  "customFormatScore",
  "customFormats",
  "episodes",
  "indexer",
  "languages",
  "leechers",
  "protocol",
  "quality",
  "rejections",
  "seeders",
  "size",
  "title",
  "token",
].sort();

/** A release with the given overrides, usable unless a field is overridden to break it. */
function release(overrides: Partial<ReleaseResource> = {}): ReleaseResource {
  return { guid: "https://indexer.test/details/x", indexerId: 1, title: "Some.Release", approved: true, downloadAllowed: true, rejections: [], ...overrides };
}

/** Converts releases to rows with fake tokens, for the pure mapping tests. */
function mapRows(input: ReleaseResource[]) {
  let n = 0;
  return toReleaseRows(input, () => `token-${(n += 1)}`);
}

beforeEach(() => {
  testCache.current = createReleaseCache({ ttlMs: RELEASE_TTL_MS, maxEntries: MAX_CACHED_RELEASES });
});

describe("toReleaseRows", () => {
  const { rows, totals } = mapRows(releases);

  it("keeps only usable releases, in upstream order", () => {
    expect(totals).toEqual({ all: 4, usenet: 3, torrent: 1 });
    expect(rows.map((r) => r.title)).toEqual([
      "Starfall.Protocol.2019.2160p.BluRay.x265-GRP",
      "Starfall.Protocol.2019.1080p.WEB-DL.x264-TOR",
      "Lantern.Road.2021.720p.WEB-DL",
      Array.from(String(releases[5].title)).slice(0, 299).join("") + "…",
    ]);
  });

  it("skips a release with no guid, and one with indexer id 0", () => {
    expect(rows.map((r) => r.title)).not.toContain("Starfall.Protocol.No.Guid");
    expect(rows.map((r) => r.title)).not.toContain("Starfall.Protocol.Zero.Indexer");
  });

  it("returns exactly the allowed keys on every row", () => {
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(ALLOWED_KEYS);
    }
  });

  it("does not carry a guid, download link, magnet link, info hash or indexer key to the browser", () => {
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("apikey");
    expect(serialized).not.toContain("FIXTUREINDEXERKEY");
    expect(serialized).not.toContain("indexer.test");
    expect(serialized).not.toContain("magnet:");
    expect(serialized).not.toContain("FIXTUREINFOHASH");
    expect(serialized).not.toContain("details/");
  });

  it("maps an approved usenet release with its formats, languages and age", () => {
    expect(rows[0]).toEqual<ReleaseRow>({
      token: "token-1",
      title: "Starfall.Protocol.2019.2160p.BluRay.x265-GRP",
      indexer: "NZBgeek",
      protocol: "usenet",
      quality: "Bluray-2160p",
      customFormats: ["x265", "HDR"],
      customFormatScore: 120,
      size: 14000000000,
      ageHours: 30.5,
      seeders: null,
      leechers: null,
      languages: ["English"],
      approved: true,
      rejections: [],
      episodes: null,
    });
  });

  it("maps a rejected torrent with its peers and rejection reasons", () => {
    expect(rows[1]).toMatchObject({
      protocol: "torrent",
      indexer: "Jackett",
      approved: false,
      seeders: 12,
      leechers: 3,
      rejections: ["Quality cutoff not met", "Release is too small"],
    });
    expect(rows[1].token).not.toBeNull();
  });

  it("gives peers only to torrents", () => {
    const [usenet] = mapRows([release({ protocol: "usenet", seeders: 5, leechers: 2 })]).rows;
    expect(usenet).toMatchObject({ protocol: "usenet", seeders: null, leechers: null });
    const [torrent] = mapRows([release({ protocol: "torrent", seeders: 5, leechers: null })]).rows;
    expect(torrent).toMatchObject({ protocol: "torrent", seeders: 5, leechers: null });
  });

  it("treats a missing protocol as unknown", () => {
    expect(mapRows([release({ protocol: undefined })]).rows[0].protocol).toBe("unknown");
  });

  it("issues no token when downloadAllowed is false or missing, so the release can't be grabbed", () => {
    expect(rows[2].token).toBeNull();
    expect(rows[3].token).toBeNull();
    expect(mapRows([release({ downloadAllowed: undefined })]).rows[0].token).toBeNull();
  });

  it("caps the title at 300 code points and cuts with an ellipsis", () => {
    const long = rows[3].title;
    expect(Array.from(long)).toHaveLength(300);
    expect(long.endsWith("…")).toBe(true);
    const exact = "x".repeat(300);
    expect(mapRows([release({ title: exact })]).rows[0].title).toBe(exact);
  });

  it("caps rejection reasons at 10", () => {
    const reasons = Array.from({ length: 15 }, (_, i) => `Reason ${i}`);
    expect(mapRows([release({ rejections: reasons })]).rows[0].rejections).toEqual(reasons.slice(0, 10));
  });

  it("drops blank rejection reasons and names", () => {
    const row = mapRows([
      release({ rejections: ["", "Real reason", null as unknown as string], customFormats: [{ name: "" }, { name: "HDR" }] }),
    ]).rows[0];
    expect(row.rejections).toEqual(["Real reason"]);
    expect(row.customFormats).toEqual(["HDR"]);
  });

  it("sets unusable numbers to safe defaults", () => {
    const row = mapRows([release({ size: -5, ageHours: -1, customFormatScore: undefined })]).rows[0];
    expect(row).toMatchObject({ size: 0, ageHours: null, customFormatScore: 0 });
  });

  it("uses null for a missing indexer name and quality", () => {
    expect(mapRows([release({ indexer: null, quality: undefined })]).rows[0]).toMatchObject({ indexer: null, quality: null });
  });

  it("calls makeToken only for returned rows that Radarr allows, with the server-side key", () => {
    const makeToken = vi.fn(() => "t");
    toReleaseRows(releases, makeToken);
    expect(makeToken).toHaveBeenCalledTimes(2);
    expect(makeToken).toHaveBeenCalledWith({
      guid: "https://indexer.test/details/1",
      indexerId: 1,
      title: "Starfall.Protocol.2019.2160p.BluRay.x265-GRP",
    });
  });

  it("returns at most MAX_RELEASES_PER_PROTOCOL rows per group but counts every usable release", () => {
    const many = Array.from({ length: MAX_RELEASES_PER_PROTOCOL + 50 }, (_, i) => release({ title: `Release ${i}`, guid: `g${i}` }));
    const makeToken = vi.fn(() => "t");
    const result = toReleaseRows(many, makeToken);
    expect(MAX_RELEASES_PER_PROTOCOL).toBe(200);
    expect(result.rows).toHaveLength(MAX_RELEASES_PER_PROTOCOL);
    // These have no protocol, so they count only in `all`.
    expect(result.totals).toEqual({ all: MAX_RELEASES_PER_PROTOCOL + 50, usenet: 0, torrent: 0 });
    expect(makeToken).toHaveBeenCalledTimes(MAX_RELEASES_PER_PROTOCOL);
    expect(result.rows[0].title).toBe("Release 0");
  });

  it("caps each protocol separately, so torrents ranked below 200 Usenet releases are still returned", () => {
    const usenet = Array.from({ length: 300 }, (_, i) => release({ protocol: "usenet", title: `U${i}`, guid: `u${i}` }));
    const torrents = Array.from({ length: 30 }, (_, i) => release({ protocol: "torrent", title: `T${i}`, guid: `t${i}` }));
    const result = mapRows([...usenet, ...torrents]);
    expect(result.totals).toEqual({ all: 330, usenet: 300, torrent: 30 });
    expect(result.rows.filter((r) => r.protocol === "usenet")).toHaveLength(MAX_RELEASES_PER_PROTOCOL);
    expect(result.rows.filter((r) => r.protocol === "torrent")).toHaveLength(30);
    // Radarr's order is kept: the kept Usenet releases come first, then the torrents.
    expect(result.rows[0].title).toBe("U0");
    expect(result.rows[MAX_RELEASES_PER_PROTOCOL].title).toBe("T0");
  });
});

describe("episodesLabel", () => {
  it("labels a full-season release as a season pack, whatever its mapping says", () => {
    expect(episodesLabel({ fullSeason: true, mappedSeasonNumber: 2, mappedEpisodeNumbers: [1, 2, 3] })).toBe("Season pack");
  });

  it("labels one mapped episode with a zero-padded season and episode", () => {
    expect(episodesLabel({ fullSeason: false, mappedSeasonNumber: 2, mappedEpisodeNumbers: [5] })).toBe("S02E05");
    expect(episodesLabel({ mappedSeasonNumber: 0, mappedEpisodeNumbers: [1] })).toBe("S00E01");
    expect(episodesLabel({ mappedSeasonNumber: 12, mappedEpisodeNumbers: [105] })).toBe("S12E105");
  });

  it("labels a range from the first to the last mapped episode", () => {
    expect(episodesLabel({ fullSeason: false, mappedSeasonNumber: 2, mappedEpisodeNumbers: [5, 6] })).toBe("S02E05-E06");
    expect(episodesLabel({ mappedSeasonNumber: 1, mappedEpisodeNumbers: [9, 10, 11] })).toBe("S01E09-E11");
  });

  it("sorts the mapped episodes and lists them when they aren't consecutive", () => {
    expect(episodesLabel({ mappedSeasonNumber: 2, mappedEpisodeNumbers: [6, 5] })).toBe("S02E05-E06");
    expect(episodesLabel({ mappedSeasonNumber: 2, mappedEpisodeNumbers: [1, 3] })).toBe("S02E01, E03");
    expect(episodesLabel({ mappedSeasonNumber: 2, mappedEpisodeNumbers: [3, 1, 3, 2] })).toBe("S02E01-E03");
  });

  it("gives a single label when the mapped list repeats one episode", () => {
    expect(episodesLabel({ mappedSeasonNumber: 2, mappedEpisodeNumbers: [5, 5] })).toBe("S02E05");
  });

  it("returns null when the release has no usable mapping", () => {
    expect(episodesLabel({})).toBeNull();
    expect(episodesLabel({ fullSeason: false, mappedSeasonNumber: null, mappedEpisodeNumbers: [5] })).toBeNull();
    expect(episodesLabel({ mappedSeasonNumber: 2, mappedEpisodeNumbers: [] })).toBeNull();
    expect(episodesLabel({ mappedSeasonNumber: 2, mappedEpisodeNumbers: null })).toBeNull();
  });

  it("returns null when the season or any episode number is not a valid whole number", () => {
    expect(episodesLabel({ mappedSeasonNumber: -1, mappedEpisodeNumbers: [1] })).toBeNull();
    expect(episodesLabel({ mappedSeasonNumber: 1.5, mappedEpisodeNumbers: [1] })).toBeNull();
    expect(episodesLabel({ mappedSeasonNumber: 2, mappedEpisodeNumbers: [0] })).toBeNull();
    expect(episodesLabel({ mappedSeasonNumber: 2, mappedEpisodeNumbers: [5, -6] })).toBeNull();
    expect(episodesLabel({ mappedSeasonNumber: 2, mappedEpisodeNumbers: [5, 6.5] })).toBeNull();
    expect(episodesLabel({ mappedSeasonNumber: 2, mappedEpisodeNumbers: [5, Number.NaN] })).toBeNull();
  });

  it("gives Radarr releases no episodes label, since they carry no TV fields", () => {
    expect(mapRows([release()]).rows[0].episodes).toBeNull();
  });

  it("takes the label from the release fields through toReleaseRows", () => {
    const tv: ReleaseLike = { guid: "g", indexerId: 1, title: "Show.S02", fullSeason: true, mappedSeasonNumber: 2 };
    const [row] = toReleaseRows([tv], () => "t").rows;
    expect(row.episodes).toBe("Season pack");
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestAt(call: number): Request {
  return fetchMock.mock.calls[call][0] as Request;
}

async function sentBody(call: number): Promise<Record<string, unknown>> {
  return JSON.parse(await requestAt(call).text()) as Record<string, unknown>;
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (e: unknown) => e as Error,
  );
}

/** Routes the search (GET) and grab (POST) calls to the given replies. A reply may throw to simulate a network error. */
function serve({ search, grab }: { search?: () => Response; grab?: () => Response }) {
  fetchMock.mockImplementation(async (req: Request) => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/api/v3/release" && search) return search();
    if (req.method === "POST" && path === "/api/v3/release" && grab) return grab();
    throw new TypeError(`unexpected request ${req.method} ${path}`);
  });
}

describe("searchReleases", () => {
  it("GETs the release list with the movie id in the query and the key only in a header", async () => {
    serve({ search: () => json(releases) });

    await searchReleases(7);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("GET");
    expect(new URL(req.url).pathname).toBe("/api/v3/release");
    expect(new URL(req.url).search).toBe("?movieId=7");
    expect(new URL(req.url).host).toBe("radarr.test:7878");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
  });

  it("returns rows and totals, with tokens that a grab can use", async () => {
    serve({ search: () => json(releases) });

    const result = await searchReleases(7);

    expect(result.totals.all).toBe(4);
    expect(result.rows).toHaveLength(4);
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  });

  it("gives the search the longer search timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    serve({ search: () => json([]) });

    await searchReleases(7);

    expect(RELEASE_SEARCH_TIMEOUT_MS).toBe(90_000);
    expect(timeout).toHaveBeenCalledWith(RELEASE_SEARCH_TIMEOUT_MS);
    expect(timeout).not.toHaveBeenCalledWith(ARR_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it("rejects a reply that is not a list as invalid", async () => {
    serve({ search: () => json({ message: "nope" }) });

    const error = await rejectionOf(searchReleases(7));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
    expect(error.message).toBe("Radarr release search response was not a list");
  });

  it("throws on HTTP 500 without leaking the key, host or body", async () => {
    serve({ search: () => new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }) });

    const error = await rejectionOf(searchReleases(7));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Radarr release search request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("radarr.test");
  });
});

describe("grabRelease", () => {
  /** Runs a search and returns the first token it issued. */
  async function firstToken(): Promise<string> {
    serve({ search: () => json(releases) });
    const { rows } = await searchReleases(7);
    fetchMock.mockReset();
    const token = rows[0].token;
    if (token === null) throw new Error("fixture's first release should be grabbable");
    return token;
  }

  it("POSTs to the release endpoint with the key in a header and exactly guid and indexerId", async () => {
    const token = await firstToken();
    serve({ grab: () => json({}) });

    await grabRelease(token);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/api/v3/release");
    expect(new URL(req.url).search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody(0)).toStrictEqual({ guid: "https://indexer.test/details/1", indexerId: 1 });
  });

  it("returns the title from the server's cache", async () => {
    const token = await firstToken();
    serve({ grab: () => json({}) });

    await expect(grabRelease(token)).resolves.toEqual({ title: "Starfall.Protocol.2019.2160p.BluRay.x265-GRP" });
  });

  it("gives the grab the longer grab timeout", async () => {
    const token = await firstToken();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    serve({ grab: () => json({}) });

    await grabRelease(token);

    expect(RELEASE_GRAB_TIMEOUT_MS).toBe(60_000);
    expect(timeout).toHaveBeenCalledWith(RELEASE_GRAB_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it("refuses a token the server never issued, without calling Radarr", async () => {
    const error = await rejectionOf(grabRelease("00000000-0000-4000-8000-000000000000"));

    expect(error).toBeInstanceOf(ReleaseGrabError);
    expect((error as ReleaseGrabError).reason).toBe("expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a Sonarr token through the Radarr grab, without calling Radarr or using the token up", async () => {
    const sonarrToken = testCache.current!.put({
      app: "sonarr",
      guid: "https://indexer.test/details/9",
      indexerId: 1,
      title: "Show.S01E01",
      context: { seriesId: 3, episodeId: 9 },
    });
    serve({ grab: () => json({}) });

    const error = await rejectionOf(grabRelease(sonarrToken));

    expect(error).toBeInstanceOf(ReleaseGrabError);
    expect(fetchMock).not.toHaveBeenCalled();
    // Still there for Sonarr to take.
    expect(testCache.current!.take(sonarrToken, "sonarr")?.release.guid).toBe("https://indexer.test/details/9");
  });

  it("lets a token work only once", async () => {
    const token = await firstToken();
    serve({ grab: () => json({}) });

    await grabRelease(token);
    const second = await rejectionOf(grabRelease(token));

    expect(second).toBeInstanceOf(ReleaseGrabError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not restore the token after a 404, since Radarr has forgotten the release", async () => {
    const token = await firstToken();
    serve({ grab: () => json({ message: "not found" }, 404) });

    const error = await rejectionOf(grabRelease(token));
    expect(error).toBeInstanceOf(ReleaseGrabError);

    const again = await rejectionOf(grabRelease(token));
    expect(again).toBeInstanceOf(ReleaseGrabError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["400", 400],
    ["409", 409],
  ])("restores the token after HTTP %s, a refusal, so a retry can grab it", async (_label, status) => {
    const token = await firstToken();
    serve({ grab: () => new Response(`refused ${FAKE_KEY}`, { status }) });

    const error = await rejectionOf(grabRelease(token));
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).status).toBe(status);
    expect(error.message).not.toContain(FAKE_KEY);

    serve({ grab: () => json({}) });
    await expect(grabRelease(token)).resolves.toEqual({ title: "Starfall.Protocol.2019.2160p.BluRay.x265-GRP" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not restore the token after HTTP 500, since the release may already have been sent", async () => {
    const token = await firstToken();
    serve({ grab: () => new Response("boom", { status: 500 }) });

    const error = await rejectionOf(grabRelease(token));
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).status).toBe(500);

    const again = await rejectionOf(grabRelease(token));
    expect(again).toBeInstanceOf(ReleaseGrabError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows a timeout and does not restore the token, so the grab cannot be repeated blindly", async () => {
    const token = await firstToken();
    serve({
      grab: () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });

    const error = await rejectionOf(grabRelease(token));
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("timeout");

    const again = await rejectionOf(grabRelease(token));
    expect(again).toBeInstanceOf(ReleaseGrabError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows a network error and does not restore the token", async () => {
    const token = await firstToken();
    serve({
      grab: () => {
        throw new TypeError("fetch failed for http://radarr.test:7878/api/v3/release");
      },
    });

    const error = await rejectionOf(grabRelease(token));
    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Radarr release grab request failed: network error");
    expect(error.message).not.toContain("radarr.test");

    const again = await rejectionOf(grabRelease(token));
    expect(again).toBeInstanceOf(ReleaseGrabError);
  });
});

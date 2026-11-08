import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as SonarrComponents } from "./generated/sonarr";
import releaseFixture from "./__fixtures__/sonarr-releases.json";
import { ArrRequestError } from "./request";
import { createReleaseCache, MAX_CACHED_RELEASES, RELEASE_TTL_MS, type ReleaseCache } from "./release-cache";
import { ReleaseGrabError, RELEASE_SEARCH_TIMEOUT_MS } from "./releases";
import { grabSeriesRelease, searchSeriesReleases, type SeriesReleaseTarget } from "./series-releases";

type SonarrRelease = SonarrComponents["schemas"]["ReleaseResource"];

const releases = releaseFixture as SonarrRelease[];

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

const EPISODE: SeriesReleaseTarget = { episodeId: 202 };
const SEASON: SeriesReleaseTarget = { seriesId: 10, seasonNumber: 2 };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  testCache.current = createReleaseCache({ ttlMs: RELEASE_TTL_MS, maxEntries: MAX_CACHED_RELEASES });
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

describe("searchSeriesReleases", () => {
  it("sends only episodeId for an episode search, and the key only in a header", async () => {
    serve({ search: () => json(releases) });

    await searchSeriesReleases(EPISODE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("GET");
    expect(url.pathname).toBe("/api/v3/release");
    expect([...url.searchParams.keys()]).toEqual(["episodeId"]);
    expect(url.searchParams.get("episodeId")).toBe("202");
    expect(url.host).toBe("sonarr.test:8989");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
  });

  it("sends seriesId and seasonNumber for a season search", async () => {
    serve({ search: () => json(releases) });

    await searchSeriesReleases(SEASON);

    const url = new URL(requestAt(0).url);
    expect([...url.searchParams.keys()].sort()).toEqual(["seasonNumber", "seriesId"]);
    expect(url.searchParams.get("seriesId")).toBe("10");
    expect(url.searchParams.get("seasonNumber")).toBe("2");
    expect(url.searchParams.has("episodeId")).toBe(false);
  });

  it("gives the search the longer search timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    serve({ search: () => json([]) });

    await searchSeriesReleases(SEASON);

    expect(timeout).toHaveBeenCalledWith(RELEASE_SEARCH_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it("maps the fixture: usable releases in order, with totals and TV episode labels", async () => {
    serve({ search: () => json(releases) });

    const result = await searchSeriesReleases(SEASON);

    expect(result.totals).toEqual({ all: 5, usenet: 3, torrent: 2, packs: { all: 1, usenet: 1, torrent: 0 } });
    expect(result.rows.map((row) => row.title)).toEqual([
      "Breaking.Bad.S02.1080p.BluRay.x264-GRP",
      "Breaking.Bad.S02E05.720p.WEB-DL.x264-TOR",
      "Breaking.Bad.S02E05E06.1080p.WEB.x264-GRP",
      "Breaking.Bad.S02E05.480p.DVDRip.x264-OLD",
      "Breaking.Bad.Unmapped.Extras.720p",
    ]);
    expect(result.rows.map((row) => row.episodes)).toEqual(["Season pack", "S02E05", "S02E05-E06", "S02E05", null]);
  });

  it("gives peers and a torrent-only field to torrents, and nothing else", async () => {
    serve({ search: () => json(releases) });

    const { rows } = await searchSeriesReleases(SEASON);

    expect(rows[1]).toMatchObject({ protocol: "torrent", seeders: 12, leechers: 3, approved: true });
    expect(rows[0]).toMatchObject({ protocol: "usenet", seeders: null, leechers: null });
  });

  it("issues no token for a release Sonarr doesn't allow to be grabbed", async () => {
    serve({ search: () => json(releases) });

    const { rows } = await searchSeriesReleases(SEASON);

    expect(rows[3]).toMatchObject({ approved: false, rejections: ["Quality cutoff not met", "Release is too old"], token: null });
    expect(rows.filter((row) => row.token !== null)).toHaveLength(4);
  });

  it("never sends a guid, indexer link, magnet link, info hash or key to the browser", async () => {
    serve({ search: () => json(releases) });

    const result = await searchSeriesReleases(EPISODE);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toContain("apikey");
    expect(serialized).not.toContain("indexer.test");
    expect(serialized).not.toContain("details/");
    expect(serialized).not.toContain("magnet:");
    expect(serialized).not.toContain("FIXTUREINFOHASH");
    expect(serialized).not.toContain("FIXTUREINDEXERKEY");
  });

  it("rejects a reply that is not a list as invalid", async () => {
    serve({ search: () => json({ message: "nope" }) });

    const error = await rejectionOf(searchSeriesReleases(SEASON));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
    expect(error.message).toBe("Sonarr release search response was not a list");
  });

  it("throws on HTTP 500 without leaking the key, host or body", async () => {
    serve({ search: () => new Response(`boom ${FAKE_KEY} at http://sonarr.test:8989`, { status: 500 }) });

    const error = await rejectionOf(searchSeriesReleases(SEASON));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr release search request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("sonarr.test");
  });
});

describe("grabSeriesRelease", () => {
  /** Runs a search for the target and returns the first token it issued. */
  async function firstToken(target: SeriesReleaseTarget): Promise<string> {
    serve({ search: () => json(releases) });
    const { rows } = await searchSeriesReleases(target);
    fetchMock.mockReset();
    const token = rows[0].token;
    if (token === null) throw new Error("fixture's first release should be grabbable");
    return token;
  }

  it("POSTs the release with the key in a header and exactly guid, indexerId and episodeId for an episode", async () => {
    const token = await firstToken(EPISODE);
    serve({ grab: () => json({}) });

    await grabSeriesRelease(token);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/api/v3/release");
    expect(new URL(req.url).search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody(0)).toStrictEqual({
      guid: "https://indexer.test/details/s2",
      indexerId: 1,
      episodeId: 202,
    });
  });

  it("leaves episodeId out of the body for a season grab", async () => {
    const token = await firstToken(SEASON);
    serve({ grab: () => json({}) });

    await grabSeriesRelease(token);

    const body = await sentBody(0);
    expect(body).toStrictEqual({ guid: "https://indexer.test/details/s2", indexerId: 1, seriesId: 10 });
    expect("episodeId" in body).toBe(false);
  });

  it("returns the title and guid from the server's cache", async () => {
    const token = await firstToken(SEASON);
    serve({ grab: () => json({}) });

    await expect(grabSeriesRelease(token)).resolves.toEqual({
      title: "Breaking.Bad.S02.1080p.BluRay.x264-GRP",
      guid: "https://indexer.test/details/s2",
    });
  });

  it("refuses a token the server never issued, without calling Sonarr", async () => {
    const error = await rejectionOf(grabSeriesRelease("00000000-0000-4000-8000-000000000000"));

    expect(error).toBeInstanceOf(ReleaseGrabError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a Radarr token, without calling Sonarr or using the token up", async () => {
    const radarrToken = testCache.current!.put({
      app: "radarr",
      guid: "https://indexer.test/details/movie",
      indexerId: 1,
      title: "Starfall.2019.1080p",
    });
    serve({ grab: () => json({}) });

    const error = await rejectionOf(grabSeriesRelease(radarrToken));

    expect(error).toBeInstanceOf(ReleaseGrabError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(testCache.current!.take(radarrToken, "radarr")?.release.title).toBe("Starfall.2019.1080p");
  });

  it("lets a token work only once", async () => {
    const token = await firstToken(SEASON);
    serve({ grab: () => json({}) });

    await grabSeriesRelease(token);
    const second = await rejectionOf(grabSeriesRelease(token));

    expect(second).toBeInstanceOf(ReleaseGrabError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives the grab the longer grab timeout", async () => {
    const token = await firstToken(SEASON);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    serve({ grab: () => json({}) });

    await grabSeriesRelease(token);

    expect(timeout).toHaveBeenCalledWith(60_000);
    timeout.mockRestore();
  });

  it("does not restore the token after a 404, since Sonarr has forgotten the release or can't match it", async () => {
    const token = await firstToken(EPISODE);
    serve({ grab: () => json({ message: "not found" }, 404) });

    const error = await rejectionOf(grabSeriesRelease(token));
    expect(error).toBeInstanceOf(ReleaseGrabError);

    const again = await rejectionOf(grabSeriesRelease(token));
    expect(again).toBeInstanceOf(ReleaseGrabError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["400", 400],
    ["409", 409],
  ])("restores the token after HTTP %s, a refusal, so a retry can grab it", async (_label, status) => {
    const token = await firstToken(SEASON);
    serve({ grab: () => new Response(`refused ${FAKE_KEY}`, { status }) });

    const error = await rejectionOf(grabSeriesRelease(token));
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).status).toBe(status);
    expect(error.message).not.toContain(FAKE_KEY);

    serve({ grab: () => json({}) });
    await expect(grabSeriesRelease(token)).resolves.toEqual({
      title: "Breaking.Bad.S02.1080p.BluRay.x264-GRP",
      guid: "https://indexer.test/details/s2",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not restore the token after HTTP 500, since the release may already have been sent", async () => {
    const token = await firstToken(SEASON);
    serve({ grab: () => new Response("boom", { status: 500 }) });

    const error = await rejectionOf(grabSeriesRelease(token));
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).status).toBe(500);

    const again = await rejectionOf(grabSeriesRelease(token));
    expect(again).toBeInstanceOf(ReleaseGrabError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows a timeout and does not restore the token", async () => {
    const token = await firstToken(SEASON);
    serve({
      grab: () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });

    const error = await rejectionOf(grabSeriesRelease(token));
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("timeout");

    const again = await rejectionOf(grabSeriesRelease(token));
    expect(again).toBeInstanceOf(ReleaseGrabError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows a network error and does not restore the token", async () => {
    const token = await firstToken(SEASON);
    serve({
      grab: () => {
        throw new TypeError("fetch failed for http://sonarr.test:8989/api/v3/release");
      },
    });

    const error = await rejectionOf(grabSeriesRelease(token));
    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr release grab request failed: network error");
    expect(error.message).not.toContain("sonarr.test");

    const again = await rejectionOf(grabSeriesRelease(token));
    expect(again).toBeInstanceOf(ReleaseGrabError);
  });
});

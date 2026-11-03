import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { components as SonarrComponents } from "./generated/sonarr";
import lookupFixture from "./__fixtures__/sonarr-series-lookup.json";

type SeriesResource = SonarrComponents["schemas"]["SeriesResource"];

// series-add.ts imports the client, which reads the saved connections. The fixed-URL helpers are tested with fetch stubbed.
vi.mock("@/server/image-cache", () => ({
  ARR_IMAGE_TTL_MS: 0,
  LOOKUP_IMAGE_TTL_MS: 0,
  cachedImage: (_key: string, _ttl: number, fetchFresh: () => Promise<unknown>) => fetchFresh(),
}));
vi.mock("@/server/settings/connections", () => ({ getConnection: () => null }));

import { ArrRequestError } from "./request";
import {
  SeriesAddError,
  TVDB_POSTER_PATH,
  addSeries,
  getTvdbPoster,
  seriesAddBody,
  toSeriesLookupResults,
  tvdbImagePath,
  tvdbPosterPath,
  type SeriesAdd,
} from "./series-add";

const clientMock = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock("./client", () => ({ sonarrClient: () => clientMock }));

const hits = lookupFixture as SeriesResource[];

/** The poster path Sonarr would give for one remotePoster URL, with no poster entry. */
const pathFor = (url: string) => tvdbPosterPath({ remotePoster: url } as SeriesResource);

describe("toSeriesLookupResults", () => {
  const results = toSeriesLookupResults(hits);

  it("skips items with no positive tvdbId and items with no title", () => {
    expect(results.map((r) => r.title)).toEqual(["Harbour Lights", "Copper Meridian", "Glass Orchard", "Signal Dust"]);
    expect(results.map((r) => r.tvdbId)).not.toContain(200003);
  });

  it("keeps upstream order", () => {
    expect(results.map((r) => r.tvdbId)).toEqual([200001, 200002, 200004, 200005]);
  });

  it("returns only the seven dialog fields", () => {
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(["inLibrary", "network", "overview", "posterPath", "title", "tvdbId", "year"]);
    }
  });

  it("marks a series in the library from Sonarr's id, and not one with a zero id", () => {
    expect(results.find((r) => r.tvdbId === 200001)?.inLibrary).toBe(true);
    expect(results.find((r) => r.tvdbId === 200002)?.inLibrary).toBe(false);
  });

  it("gives a v4 poster path from remotePoster and an old-style path from the poster entry", () => {
    expect(results.find((r) => r.tvdbId === 200001)?.posterPath).toBe("banners/v4/series/200001/posters/5f2e8d5ae9d1c.jpg");
    expect(results.find((r) => r.tvdbId === 200002)?.posterPath).toBe("banners/posters/200002-10.jpg");
  });

  it("gives no poster for a hostile or non-https poster URL", () => {
    expect(results.find((r) => r.tvdbId === 200004)?.posterPath).toBeNull();
    expect(results.find((r) => r.tvdbId === 200005)?.posterPath).toBeNull();
  });

  it("maps a year and a network, using null for a missing or non-positive one", () => {
    expect(results.find((r) => r.tvdbId === 200001)).toMatchObject({ year: 2018, network: "Northwind TV" });
    expect(results.find((r) => r.tvdbId === 200004)?.year).toBeNull();
    expect(results.find((r) => r.tvdbId === 200002)?.network).toBeNull();
  });

  it("cuts a long overview to 300 code points, ending with an ellipsis, and keeps a short one", () => {
    const long = toSeriesLookupResults([{ tvdbId: 1, title: "Long", overview: "a".repeat(400) } as SeriesResource]);
    expect(Array.from(long[0].overview)).toHaveLength(300);
    expect(long[0].overview.endsWith("…")).toBe(true);
    expect(results.find((r) => r.tvdbId === 200001)?.overview).toBe(hits[0].overview);
  });

  it("caps the list at 20 results, keeping the first 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ tvdbId: i + 1, title: `Show ${i + 1}` }) as SeriesResource);
    const capped = toSeriesLookupResults(many);
    expect(capped).toHaveLength(20);
    expect(capped[19].tvdbId).toBe(20);
  });
});

describe("tvdbImagePath", () => {
  it("gives the same path as tvdbPosterPath for a TVDB poster URL", () => {
    expect(tvdbImagePath("https://artworks.thetvdb.com/banners/v4/season/81189-1/posters/abc.jpg")).toBe(
      "banners/v4/season/81189-1/posters/abc.jpg",
    );
  });

  it("returns null for a missing, empty or non-string value", () => {
    expect(tvdbImagePath(undefined)).toBeNull();
    expect(tvdbImagePath(null)).toBeNull();
    expect(tvdbImagePath("")).toBeNull();
    expect(tvdbImagePath(42 as unknown as string)).toBeNull();
  });

  it("returns null for a URL on another host or a path that does not match", () => {
    expect(tvdbImagePath("https://example.invalid/banners/posters/abc.jpg")).toBeNull();
    expect(tvdbImagePath("https://artworks.thetvdb.com/banners/posters/abc.png")).toBeNull();
    expect(tvdbImagePath("not a url")).toBeNull();
  });
});

describe("tvdbPosterPath", () => {
  it("accepts a v4 path and an old-style path on the TVDB host", () => {
    expect(pathFor("https://artworks.thetvdb.com/banners/v4/series/81189/posters/5f2e8d5ae9d1c.jpg")).toBe(
      "banners/v4/series/81189/posters/5f2e8d5ae9d1c.jpg",
    );
    expect(pathFor("https://artworks.thetvdb.com/banners/posters/81189-10.jpg")).toBe("banners/posters/81189-10.jpg");
  });

  it("accepts exactly five directory levels and rejects six", () => {
    expect(pathFor("https://artworks.thetvdb.com/banners/a/b/c/d/e/x.jpg")).toBe("banners/a/b/c/d/e/x.jpg");
    expect(pathFor("https://artworks.thetvdb.com/banners/a/b/c/d/e/f/x.jpg")).toBeNull();
  });

  it("rejects a traversal, encoded or raw", () => {
    expect(pathFor("https://artworks.thetvdb.com/banners/../x.jpg")).toBeNull();
    expect(pathFor("https://artworks.thetvdb.com/banners/%2e%2e/x.jpg")).toBeNull();
    expect(pathFor("https://artworks.thetvdb.com/banners/%2e%2e%2Fx.jpg")).toBeNull();
  });

  it("rejects a file that is not a bare .jpg", () => {
    expect(pathFor("https://artworks.thetvdb.com/banners/posters/abc.png")).toBeNull();
    expect(pathFor("https://artworks.thetvdb.com/banners/posters/abc.JPG")).toBeNull();
    expect(pathFor("https://artworks.thetvdb.com/banners/posters/abc.jpg.exe")).toBeNull();
  });

  it("rejects a port, credentials, a query string and a fragment", () => {
    expect(pathFor("https://artworks.thetvdb.com:8443/banners/posters/abc.jpg")).toBeNull();
    expect(pathFor("https://user@artworks.thetvdb.com/banners/posters/abc.jpg")).toBeNull();
    expect(pathFor("https://artworks.thetvdb.com/banners/posters/abc.jpg?x=1")).toBeNull();
    expect(pathFor("https://artworks.thetvdb.com/banners/posters/abc.jpg#x")).toBeNull();
  });

  it("rejects another host, a lookalike host, plain http, and a path outside banners", () => {
    expect(pathFor("https://artworks.thetvdb.com.evil.example/banners/posters/abc.jpg")).toBeNull();
    expect(pathFor("https://evil.example/banners/posters/abc.jpg")).toBeNull();
    expect(pathFor("http://artworks.thetvdb.com/banners/posters/abc.jpg")).toBeNull();
    expect(pathFor("https://artworks.thetvdb.com/other/posters/abc.jpg")).toBeNull();
  });

  it("returns null when there is no poster or the URL does not parse", () => {
    expect(tvdbPosterPath({} as SeriesResource)).toBeNull();
    expect(pathFor("not a url")).toBeNull();
  });

  it("only accepts paths that match TVDB_POSTER_PATH", () => {
    expect(TVDB_POSTER_PATH.test("banners/posters/abc.jpg")).toBe(true);
    expect(TVDB_POSTER_PATH.test("banners/posters/abc.jpg/")).toBe(false);
    expect(TVDB_POSTER_PATH.test("posters/abc.jpg")).toBe(false);
  });
});

describe("seriesAddBody", () => {
  const add: SeriesAdd = {
    tvdbId: 200001,
    qualityProfileId: 1,
    rootFolderPath: "/invented/tv/",
    monitor: "all",
    seriesType: "standard",
    seasonFolder: true,
    searchForMissingEpisodes: true,
  };

  it("sends exactly the fixed field set for a monitored add", () => {
    expect(seriesAddBody(add, { title: "Harbour Lights", titleSlug: "harbour-lights", year: 2018 })).toStrictEqual({
      tvdbId: 200001,
      title: "Harbour Lights",
      titleSlug: "harbour-lights",
      year: 2018,
      qualityProfileId: 1,
      rootFolderPath: "/invented/tv/",
      seriesType: "standard",
      seasonFolder: true,
      monitored: true,
      monitorNewItems: "all",
      addOptions: { monitor: "all", searchForMissingEpisodes: true, searchForCutoffUnmetEpisodes: false },
    });
  });

  it("sends the season folder choice from the add", () => {
    expect(seriesAddBody({ ...add, seasonFolder: false }, { title: "X", titleSlug: null, year: null }).seasonFolder).toBe(false);
  });

  it("maps monitor none to unmonitored series and new items, and leaves out unknown year and slug", () => {
    expect(seriesAddBody({ ...add, monitor: "none", searchForMissingEpisodes: false }, { title: "X", titleSlug: null, year: null })).toStrictEqual({
      tvdbId: 200001,
      title: "X",
      qualityProfileId: 1,
      rootFolderPath: "/invented/tv/",
      seriesType: "standard",
      seasonFolder: true,
      monitored: false,
      monitorNewItems: "none",
      addOptions: { monitor: "none", searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false },
    });
  });
});

describe("addSeries", () => {
  const add: SeriesAdd = {
    tvdbId: 200001,
    qualityProfileId: 1,
    rootFolderPath: "/invented/tv/",
    monitor: "future",
    seriesType: "anime",
    seasonFolder: false,
    searchForMissingEpisodes: false,
  };
  const lookupHit = { tvdbId: 200001, title: "Harbour Lights", year: 2018, titleSlug: "harbour-lights" } as SeriesResource;

  beforeEach(() => {
    clientMock.GET.mockReset();
    clientMock.POST.mockReset();
  });

  it("refuses with not-found when the lookup has no hit for the id, and never checks the library or adds", async () => {
    clientMock.GET.mockResolvedValue({ data: [{ tvdbId: 999, title: "Other" }], response: new Response(null, { status: 200 }) });

    const error = await addSeries(add).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SeriesAddError);
    expect((error as SeriesAddError).reason).toBe("not-found");
    expect(clientMock.GET).toHaveBeenCalledTimes(1);
    expect(clientMock.POST).not.toHaveBeenCalled();
  });

  it("refuses with not-found when the hit has a blank title", async () => {
    clientMock.GET.mockResolvedValue({ data: [{ tvdbId: 200001, title: "  " }], response: new Response(null, { status: 200 }) });
    const error = await addSeries(add).catch((e: unknown) => e);
    expect((error as SeriesAddError).reason).toBe("not-found");
    expect(clientMock.POST).not.toHaveBeenCalled();
  });

  it("refuses with exists when the library already has the TVDB id, and does not add", async () => {
    clientMock.GET
      .mockResolvedValueOnce({ data: [lookupHit], response: new Response(null, { status: 200 }) })
      .mockResolvedValueOnce({ data: [{ id: 5, tvdbId: 200001 }], response: new Response(null, { status: 200 }) });

    const error = await addSeries(add).catch((e: unknown) => e);

    expect((error as SeriesAddError).reason).toBe("exists");
    expect(clientMock.POST).not.toHaveBeenCalled();
  });

  it("rethrows a lookup failure as ArrRequestError, not as not-found", async () => {
    clientMock.GET.mockResolvedValue({ data: undefined, response: new Response(null, { status: 500 }) });
    const error = await addSeries(add).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).status).toBe(500);
  });

  it("looks up by tvdb: term and checks the library by tvdbId, then adds the fixed body with the lookup's title and year", async () => {
    clientMock.GET
      .mockResolvedValueOnce({ data: [lookupHit], response: new Response(null, { status: 200 }) })
      .mockResolvedValueOnce({ data: [], response: new Response(null, { status: 200 }) });
    clientMock.POST.mockResolvedValue({ data: {}, response: new Response(null, { status: 201 }) });

    await expect(addSeries(add)).resolves.toEqual({ id: null, title: "Harbour Lights", year: 2018 });

    expect(clientMock.GET.mock.calls[0][1].params.query).toEqual({ term: "tvdb:200001" });
    expect(clientMock.GET.mock.calls[1][1].params.query).toEqual({ tvdbId: 200001 });
    expect(clientMock.POST.mock.calls[0][1].body).toStrictEqual(
      seriesAddBody(add, { title: "Harbour Lights", titleSlug: "harbour-lights", year: 2018 }),
    );
  });

  it.each([
    ["a positive id", { id: 88 }, 88],
    ["a zero id", { id: 0 }, null],
    ["a fractional id", { id: 2.5 }, null],
    ["a string id", { id: "88" }, null],
    ["no id", {}, null],
  ])("returns the new Sonarr id from the add reply when it is %s", async (_name, reply, expected) => {
    clientMock.GET
      .mockResolvedValueOnce({ data: [lookupHit], response: new Response(null, { status: 200 }) })
      .mockResolvedValueOnce({ data: [], response: new Response(null, { status: 200 }) });
    clientMock.POST.mockResolvedValue({ data: reply, response: new Response(null, { status: 201 }) });

    await expect(addSeries(add)).resolves.toEqual({ id: expected, title: "Harbour Lights", year: 2018 });
  });
});

describe("getTvdbPoster", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("rejects a bad path without fetching", async () => {
    await expect(getTvdbPoster("banners/../etc.jpg")).rejects.toThrow("TVDB poster request failed: invalid name");
    await expect(getTvdbPoster("https://evil.example/x.jpg")).rejects.toThrow("TVDB poster request failed: invalid name");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the fixed TVDB URL with no redirects and no headers", async () => {
    fetchMock.mockResolvedValue(new Response(JPEG, { status: 200 }));
    await expect(getTvdbPoster("banners/posters/81189-10.jpg")).resolves.toEqual(JPEG);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://artworks.thetvdb.com/banners/posters/81189-10.jpg");
    expect(init.redirect).toBe("error");
    expect(init.headers).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects a body that is not a JPEG", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(getTvdbPoster("banners/posters/81189-10.jpg")).rejects.toThrow("TVDB poster response was not a usable image");
  });
});

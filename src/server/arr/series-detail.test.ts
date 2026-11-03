import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as SonarrComponents } from "./generated/sonarr";
import detailFixture from "./__fixtures__/sonarr-series-detail.json";
import episodesFixture from "./__fixtures__/sonarr-episodes.json";
import profileFixture from "./__fixtures__/sonarr-qualityprofiles.json";
import { ArrRequestError } from "./request";

type SeriesResource = SonarrComponents["schemas"]["SeriesResource"];
type SeasonResource = SonarrComponents["schemas"]["SeasonResource"];
type EpisodeResource = SonarrComponents["schemas"]["EpisodeResource"];
type QualityProfileResource = SonarrComponents["schemas"]["QualityProfileResource"];

const series = detailFixture as SeriesResource;
const episodes = episodesFixture as EpisodeResource[];
const profiles = profileFixture as QualityProfileResource[];

// A fixed clock: episodes air-dated before this are past, the 2027 one is in the future.
const NOW = Date.parse("2026-06-01T00:00:00Z");

const { FAKE_KEY, fakeConnections } = vi.hoisted(() => {
  const key = "fake-api-key-0123456789abcdefghi"; // 32 chars, not a real secret
  return {
    FAKE_KEY: key,
    fakeConnections: {
      radarr: { url: "http://radarr.test:7878", apiKey: key },
      sonarr: { url: "http://sonarr.test:8989", apiKey: key },
    },
  };
});

vi.mock("@/server/settings/connections", () => ({
  getConnection: (app: "radarr" | "sonarr") => fakeConnections[app],
}));

import { getSeriesDetail, toSeriesDetail } from "./series-detail";
import { sortedProfileOptions } from "./profiles";

function detail(overrides: Partial<SeriesResource> = {}, episodeList: EpisodeResource[] = episodes) {
  return toSeriesDetail({ ...series, ...overrides }, episodeList, profiles, NOW);
}

function statusesOf(seasonNumber: number) {
  const season = detail()?.seasons.find((s) => s.seasonNumber === seasonNumber);
  return season?.episodes.map((e) => [e.episodeNumber, e.status]);
}

/** Every key name in a value, recursively. Used to check that no path-like key is in the output. */
function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, out));
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      keysDeep(child, out);
    }
  }
  return out;
}

describe("toSeriesDetail", () => {
  it("maps the series header fields", () => {
    expect(detail()).toMatchObject({
      id: 10,
      title: "Lantern Row",
      year: 2020,
      status: "continuing",
      network: "Northwind TV",
      overview: "Invented overview text for the series detail page.",
      monitored: true,
      qualityProfile: "HD-1080p",
      hasPoster: true,
    });
  });

  it("carries the profile id, series type, season folders and new-season monitoring the settings form starts from", () => {
    expect(detail()).toMatchObject({
      qualityProfileId: 1,
      seriesType: "standard",
      seasonFolder: true,
      // The fixture has no monitorNewItems, so the form has no value to start from.
      monitorNewItems: null,
    });
    expect(detail({ monitorNewItems: "all" })?.monitorNewItems).toBe("all");
    expect(detail({ monitorNewItems: "none" })?.monitorNewItems).toBe("none");
    expect(detail({ seasonFolder: false })?.seasonFolder).toBe(false);
    expect(detail({ seasonFolder: undefined })?.seasonFolder).toBe(false);
    expect(detail({ seriesType: "anime" })?.seriesType).toBe("anime");
  });

  it("gives a null type or monitor value for anything the form does not offer", () => {
    expect(detail({ seriesType: "weird" as unknown as SeriesResource["seriesType"] })?.seriesType).toBeNull();
    expect(detail({ seriesType: undefined })?.seriesType).toBeNull();
    expect(detail({ monitorNewItems: "future" as unknown as SeriesResource["monitorNewItems"] })?.monitorNewItems).toBeNull();
  });

  it("returns exactly the page's top-level fields", () => {
    expect(Object.keys(detail() ?? {}).sort()).toEqual(
      [
        "id",
        "title",
        "year",
        "status",
        "network",
        "overview",
        "monitored",
        "qualityProfile",
        "qualityProfileId",
        "seriesType",
        "seasonFolder",
        "monitorNewItems",
        "hasPoster",
        "hasBackdrop",
        "genres",
        "certification",
        "runtime",
        "rating",
        "firstAired",
        "lastAired",
        "nextAiring",
        "added",
        "language",
        "episodeFileCount",
        "episodeCount",
        "sizeOnDisk",
        "imdbId",
        "tvdbId",
        "tmdbId",
        "seasons",
      ].sort(),
    );
  });

  it("maps the new header fields from the series", () => {
    expect(detail()).toMatchObject({
      hasBackdrop: true,
      genres: ["Drama"],
      certification: "TV-14",
      runtime: 45,
      rating: 8.4,
      firstAired: "2020-01-10T00:00:00Z",
      lastAired: "2024-06-01T00:00:00Z",
      nextAiring: "2027-02-01T00:00:00Z",
      added: "2024-03-01T10:00:00Z",
      language: "English",
      episodeFileCount: 2,
      episodeCount: 7,
      sizeOnDisk: 1073741824,
      imdbId: "tt0000101",
      tvdbId: 100010,
      tmdbId: 200010,
    });
  });

  it("reports a backdrop only when a fanart cover exists", () => {
    expect(detail({ images: [{ coverType: "poster" }] })?.hasBackdrop).toBe(false);
    expect(detail({ images: undefined })?.hasBackdrop).toBe(false);
  });

  it("keeps up to five non-empty genres, in order", () => {
    const genres = ["Drama", "", "  ", "Thriller", "Mystery", "Crime", "Western", "Horror"];
    expect(detail({ genres })?.genres).toEqual(["Drama", "Thriller", "Mystery", "Crime", "Western"]);
    expect(detail({ genres: undefined })?.genres).toEqual([]);
  });

  it("shows the certification, the air dates and the language only when Sonarr sends them", () => {
    expect(detail({ certification: "", firstAired: "", lastAired: null, nextAiring: undefined, originalLanguage: { id: 1, name: "" } })).toMatchObject({
      certification: null,
      firstAired: null,
      lastAired: null,
      nextAiring: null,
      language: null,
    });
    expect(detail({ certification: undefined, originalLanguage: undefined })).toMatchObject({
      certification: null,
      language: null,
    });
  });

  it("shows no runtime for 0 or a missing runtime, and the minutes otherwise", () => {
    expect(detail({ runtime: 0 })?.runtime).toBeNull();
    expect(detail({ runtime: undefined })?.runtime).toBeNull();
    expect(detail({ runtime: 30 })?.runtime).toBe(30);
  });

  it("gives a rating only when it has votes and a positive value", () => {
    expect(detail({ ratings: { votes: 0, value: 8.4 } })?.rating).toBeNull();
    expect(detail({ ratings: { votes: 12, value: 0 } })?.rating).toBeNull();
    expect(detail({ ratings: { votes: 12 } })?.rating).toBeNull();
    expect(detail({ ratings: undefined })?.rating).toBeNull();
    expect(detail({ ratings: { votes: 3, value: 6.5 } })?.rating).toBe(6.5);
  });

  it("keeps the IMDb id only when it has the tt-and-digits shape", () => {
    expect(detail({ imdbId: "tt1234567" })).toMatchObject({ imdbId: "tt1234567" });
    expect(detail({ imdbId: "https://example.invalid/tt1" })).toMatchObject({ imdbId: null });
    expect(detail({ imdbId: "tt12345678901" })).toMatchObject({ imdbId: null });
    expect(detail({ imdbId: null })).toMatchObject({ imdbId: null });
  });

  it("keeps the TVDB and TMDB ids only when they are positive integers", () => {
    expect(detail({ tvdbId: 0 })?.tvdbId).toBeNull();
    expect(detail({ tvdbId: -3 })?.tvdbId).toBeNull();
    expect(detail({ tvdbId: 1.5 })?.tvdbId).toBeNull();
    expect(detail({ tvdbId: undefined })?.tvdbId).toBeNull();
    expect(detail({ tmdbId: 0 })?.tmdbId).toBeNull();
    expect(detail({ tmdbId: -3 })?.tmdbId).toBeNull();
    expect(detail({ tmdbId: 1.5 })?.tmdbId).toBeNull();
    expect(detail({ tmdbId: undefined })?.tmdbId).toBeNull();
  });

  it("gives a season poster path only for a TVDB poster, and null otherwise", () => {
    const withSeason1Images = (images: SeasonResource["images"]) =>
      detail({ seasons: series.seasons?.map((s) => (s.seasonNumber === 1 ? { ...s, images } : s)) });
    const season = (result: ReturnType<typeof detail>, n: number) => result?.seasons.find((s) => s.seasonNumber === n);

    // The fixture's season 1 poster is on artworks.thetvdb.com, so it becomes a path.
    expect(season(detail(), 1)?.posterPath).toBe("banners/v4/season/100010-1/posters/invented-s1.jpg");
    // Season 2's poster is on another host, and season 0 has no images at all.
    expect(season(detail(), 2)?.posterPath).toBeNull();
    expect(season(detail(), 0)?.posterPath).toBeNull();
    // A season only present because of an episode has no images.
    expect(season(detail(), 3)?.posterPath).toBeNull();
    expect(season(withSeason1Images(undefined), 1)?.posterPath).toBeNull();
    expect(season(withSeason1Images([{ coverType: "poster", remoteUrl: "https://example.invalid/x.jpg" }]), 1)?.posterPath).toBeNull();
    expect(season(withSeason1Images([{ coverType: "banner", remoteUrl: "https://artworks.thetvdb.com/banners/x.jpg" }]), 1)?.posterPath).toBeNull();
    // remoteUrl missing or off-host: url is tried next.
    expect(season(withSeason1Images([{ coverType: "poster", url: "https://artworks.thetvdb.com/banners/seasons/s1.jpg" }]), 1)?.posterPath).toBe(
      "banners/seasons/s1.jpg",
    );
    expect(
      season(
        withSeason1Images([
          { coverType: "poster", remoteUrl: "https://example.invalid/x.jpg", url: "https://artworks.thetvdb.com/banners/seasons/s1.jpg" },
        ]),
        1,
      )?.posterPath,
    ).toBe("banners/seasons/s1.jpg");
  });

  it("uses zero counts and size when Sonarr omits the series statistics", () => {
    expect(detail({ statistics: undefined })).toMatchObject({
      episodeFileCount: 0,
      episodeCount: 0,
      sizeOnDisk: 0,
    });
  });

  it("returns null for a series with no numeric id or no title", () => {
    expect(detail({ id: undefined })).toBeNull();
    expect(detail({ title: "" })).toBeNull();
    expect(detail({ title: undefined })).toBeNull();
  });

  it("labels an unknown quality profile the same way the table does", () => {
    expect(detail({ qualityProfileId: 99 })?.qualityProfile).toBe("Unknown profile (#99)");
  });

  it("maps each episode status: downloaded, missing, unaired, unmonitored", () => {
    // 101 has a file, 102 is past and monitored, 103 is in the future, 104 has no air date, 105 is unmonitored.
    expect(statusesOf(1)).toEqual([
      [1, "downloaded"],
      [2, "missing"],
      [3, "unaired"],
      [4, "unaired"],
      [5, "unmonitored"],
      [6, "missing"],
      [8, "downloaded"],
    ]);
  });

  it("reports a file as downloaded even when the episode is not monitored", () => {
    const episode = detail()?.seasons.find((s) => s.seasonNumber === 1)?.episodes.find((e) => e.episodeNumber === 8);
    expect(episode).toMatchObject({ monitored: false, status: "downloaded", quality: "Bluray-1080p" });
  });

  it("reports an aired episode as unmonitored when its series or season is unmonitored", () => {
    // Sonarr only searches when the series, season and episode are all monitored.
    const unmonitoredSeries = detail({ monitored: false })?.seasons.find((s) => s.seasonNumber === 1);
    expect(unmonitoredSeries?.episodes.find((e) => e.episodeNumber === 2)?.status).toBe("unmonitored");
    const unmonitoredSeason = detail({
      seasons: series.seasons?.map((s) => (s.seasonNumber === 1 ? { ...s, monitored: false } : s)),
    })?.seasons.find((s) => s.seasonNumber === 1);
    expect(unmonitoredSeason?.episodes.find((e) => e.episodeNumber === 2)?.status).toBe("unmonitored");
    // The episode's own flag is still reported as Sonarr sent it.
    expect(unmonitoredSeason?.episodes.find((e) => e.episodeNumber === 2)?.monitored).toBe(true);
  });

  it("shows the local air date, not the UTC date", () => {
    // Episode 1 aired on the evening of 10 Jan local time, which is 11 Jan in UTC.
    const episode = detail()?.seasons.find((s) => s.seasonNumber === 1)?.episodes[0];
    expect(episode?.airDate).toBe("2020-01-10");
  });

  it("drops an air date that isn't a plain YYYY-MM-DD", () => {
    const [episode] = episodes.filter((e) => e.id === 102);
    const odd = detail({}, [{ ...episode, airDate: "Jan 17 2020" }])?.seasons.find((s) => s.seasonNumber === 1);
    expect(odd?.episodes[0].airDate).toBeNull();
  });

  it("takes quality and size from the episode file, and shows no quality without a file", () => {
    const season1 = detail()?.seasons.find((s) => s.seasonNumber === 1);
    expect(season1?.episodes[0]).toMatchObject({ quality: "Bluray-1080p", size: 1073741824 });
    expect(season1?.episodes[1]).toMatchObject({ quality: null, size: 0 });
  });

  it("uses TBA for a missing title and null for a missing air date", () => {
    const season1 = detail()?.seasons.find((s) => s.seasonNumber === 1);
    expect(season1?.episodes.find((e) => e.episodeNumber === 6)?.title).toBe("TBA");
    expect(season1?.episodes.find((e) => e.episodeNumber === 4)).toMatchObject({
      title: "Fourth Tide",
      airDate: null,
    });
  });

  it("orders seasons newest first with Specials last, and labels them", () => {
    const seasons = detail()?.seasons ?? [];
    expect(seasons.map((s) => s.seasonNumber)).toEqual([3, 2, 1, 0]);
    expect(seasons.map((s) => s.label)).toEqual(["Season 3", "Season 2", "Season 1", "Specials"]);
  });

  it("orders episodes within a season by episode number, whatever order Sonarr sends them in", () => {
    // Season 2 is sent as 202 then 201.
    const numbers = detail()?.seasons.find((s) => s.seasonNumber === 2)?.episodes.map((e) => e.episodeNumber);
    expect(numbers).toEqual([1, 2]);
  });

  it("takes season stats from the series, and zeros when a season has no statistics", () => {
    const season1 = detail()?.seasons.find((s) => s.seasonNumber === 1);
    expect(season1).toMatchObject({
      monitored: true,
      episodeFileCount: 1,
      episodeCount: 4,
      totalEpisodeCount: 6,
      sizeOnDisk: 1073741824,
    });
    const orphan = detail()?.seasons.find((s) => s.seasonNumber === 3);
    expect(orphan).toMatchObject({
      monitored: false,
      episodeFileCount: 0,
      episodeCount: 0,
      totalEpisodeCount: 0,
      sizeOnDisk: 0,
    });
  });

  it("keeps an episode whose season is not listed on the series, as a season row", () => {
    const orphan = detail()?.seasons.find((s) => s.seasonNumber === 3);
    expect(orphan?.episodes).toEqual([
      {
        id: 301,
        episodeNumber: 1,
        title: "Orphan Season Episode",
        airDate: "2022-01-01",
        // A season Sonarr doesn't list has no monitored flag, so nothing in it is wanted.
        status: "unmonitored",
        monitored: true,
        quality: null,
        size: 0,
      },
    ]);
  });

  it("skips episodes with no id, no season number or no episode number", () => {
    const allIds = detail()?.seasons.flatMap((s) => s.episodes.map((e) => e.id)) ?? [];
    expect(allIds).not.toContain(undefined);
    expect(allIds).not.toContain(901);
    expect(allIds).not.toContain(902);
    expect(allIds.length).toBe(episodes.length - 3);
  });

  it("gives a season with no episodes an empty list, not a missing one", () => {
    const emptySeries = detail({
      seasons: [{ seasonNumber: 4, monitored: true, statistics: { episodeFileCount: 0, episodeCount: 0, totalEpisodeCount: 0, sizeOnDisk: 0 } }],
    }, []);
    expect(emptySeries?.seasons).toEqual([
      {
        seasonNumber: 4,
        label: "Season 4",
        monitored: true,
        episodeFileCount: 0,
        episodeCount: 0,
        totalEpisodeCount: 0,
        sizeOnDisk: 0,
        posterPath: null,
        episodes: [],
      },
    ]);
  });

  it("returns no path, relativePath or fixture path in any output", () => {
    const output = detail();
    expect(output).not.toBeNull();
    const keys = keysDeep(output);
    expect(keys).not.toContain("path");
    expect(keys).not.toContain("relativePath");
    expect(keys).not.toContain("rootFolderPath");
    expect(JSON.stringify(output)).not.toContain("/invented/");
    expect(JSON.stringify(output)).not.toContain("Lantern Row/");
  });
});

const profileResponse = () => new Response(JSON.stringify(profiles), { status: 200, headers: { "Content-Type": "application/json" } });

describe("getSeriesDetail", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Routes the three Sonarr calls. A reply may be a function that returns a Response. */
  function serve(
    seriesReply: () => Response,
    episodeReply: () => Response = () =>
      new Response(JSON.stringify(episodes), { status: 200, headers: { "Content-Type": "application/json" } }),
  ) {
    fetchMock.mockImplementation(async (req: Request) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/v3/series/10") return seriesReply();
      if (url.pathname === "/api/v3/episode") return episodeReply();
      if (url.pathname === "/api/v3/qualityprofile") return profileResponse();
      throw new TypeError(`unexpected request to ${url.pathname}`);
    });
  }

  it("returns null when Sonarr answers 404 for the series", async () => {
    serve(() => new Response("not found", { status: 404 }));

    await expect(getSeriesDetail(10)).resolves.toBeNull();
  });

  it("propagates a 404 from the episode request instead of calling the series not found", async () => {
    serve(
      () => new Response(JSON.stringify(series), { status: 200, headers: { "Content-Type": "application/json" } }),
      () => new Response("not found", { status: 404 }),
    );

    const error = await getSeriesDetail(10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).status).toBe(404);
  });

  it("propagates other Sonarr failures instead of returning null", async () => {
    serve(() => new Response("boom", { status: 500 }));

    const error = await getSeriesDetail(10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).status).toBe(500);
  });

  it("requests the series, its episodes with files, and the profiles, with the key in a header", async () => {
    serve(() => new Response(JSON.stringify(series), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await getSeriesDetail(10);

    expect(result?.detail.title).toBe("Lantern Row");
    expect(result?.profiles).toEqual(sortedProfileOptions(profiles));
    const requests = fetchMock.mock.calls.map((call) => call[0] as Request);
    const urls = requests.map((req) => new URL(req.url));
    expect(urls.map((u) => u.pathname).sort()).toEqual(["/api/v3/episode", "/api/v3/qualityprofile", "/api/v3/series/10"]);
    const episodeUrl = urls.find((u) => u.pathname === "/api/v3/episode");
    expect(episodeUrl?.searchParams.get("seriesId")).toBe("10");
    expect(episodeUrl?.searchParams.get("includeEpisodeFile")).toBe("true");
    for (const req of requests) {
      expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
      expect(req.url).not.toContain("apikey");
      expect(req.url).not.toContain(FAKE_KEY);
      expect(req.redirect).toBe("error");
    }
  });
});

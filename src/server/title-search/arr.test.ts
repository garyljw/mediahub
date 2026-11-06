import "server-only";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";
import type { LookupResult } from "@/server/arr/movie-add";
import type { SeriesLookupResult } from "@/server/arr/series-add";

const mocks = vi.hoisted(() => ({
  lookupMovies: vi.fn(),
  lookupSeries: vi.fn(),
}));

vi.mock("@/server/arr/movie-add", () => ({ lookupMovies: mocks.lookupMovies }));
vi.mock("@/server/arr/series-add", () => ({ lookupSeries: mocks.lookupSeries }));

import { arrTitleSearch, movieHits, seriesHits } from "./arr";
import { TitleSearchError } from "./types";

const movie: LookupResult = {
  tmdbId: 550,
  title: "Fight Club",
  year: 1999,
  overview: "An insomniac office worker.",
  inLibrary: false,
  posterFile: "abc123.jpg",
};

const series: SeriesLookupResult = {
  tvdbId: 81189,
  title: "Example Show",
  year: 2010,
  network: "Example Network",
  overview: "A made-up series.",
  inLibrary: true,
  posterPath: "banners/v4/series/81189/posters/5f2e8d.jpg",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("movieHits", () => {
  it("maps a Radarr hit to a title hit, with the Add page's poster route and no network", () => {
    expect(movieHits([movie])).toEqual([
      {
        externalId: 550,
        title: "Fight Club",
        year: 1999,
        network: null,
        overview: "An insomniac office worker.",
        posterSrc: "/api/movies/lookup-poster/abc123.jpg",
        inLibrary: false,
      },
    ]);
  });

  it("gives no poster when the hit has none, and keeps the library flag", () => {
    const [hit] = movieHits([{ ...movie, posterFile: null, inLibrary: true }]);
    expect(hit.posterSrc).toBeNull();
    expect(hit.inLibrary).toBe(true);
  });

  it("keeps the upstream order", () => {
    expect(movieHits([movie, { ...movie, tmdbId: 1, title: "Other" }]).map((hit) => hit.externalId)).toEqual([550, 1]);
  });
});

describe("seriesHits", () => {
  it("maps a Sonarr hit to a title hit, with the network and the TV poster route", () => {
    expect(seriesHits([series])).toEqual([
      {
        externalId: 81189,
        title: "Example Show",
        year: 2010,
        network: "Example Network",
        overview: "A made-up series.",
        posterSrc: "/api/tv/lookup-poster/banners/v4/series/81189/posters/5f2e8d.jpg",
        inLibrary: true,
      },
    ]);
  });

  it("gives no poster when the hit has none", () => {
    expect(seriesHits([{ ...series, posterPath: null }])[0].posterSrc).toBeNull();
  });
});

describe("arrTitleSearch", () => {
  it("searches Radarr for movies and maps the hits", async () => {
    mocks.lookupMovies.mockResolvedValue([movie]);
    const hits = await arrTitleSearch.search("movie", "fight");
    expect(mocks.lookupMovies).toHaveBeenCalledWith("fight");
    expect(hits).toEqual(movieHits([movie]));
  });

  it("searches Sonarr for series and maps the hits", async () => {
    mocks.lookupSeries.mockResolvedValue([series]);
    const hits = await arrTitleSearch.search("series", "example");
    expect(mocks.lookupSeries).toHaveBeenCalledWith("example");
    expect(hits).toEqual(seriesHits([series]));
  });

  it("turns a Radarr failure into a TitleSearchError with a safe message, and logs only that message", async () => {
    mocks.lookupMovies.mockRejectedValue(new ArrRequestError("Radarr movie lookup request failed: HTTP 503", "http", 503));
    const failure = arrTitleSearch.search("movie", "fight");
    await expect(failure).rejects.toBeInstanceOf(TitleSearchError);
    await expect(failure).rejects.toThrow("Radarr couldn't complete the search");
    expect(console.error).toHaveBeenCalledWith("Title search: Radarr movie lookup request failed: HTTP 503");
  });

  it("turns a Sonarr failure into a TitleSearchError naming Sonarr", async () => {
    mocks.lookupSeries.mockRejectedValue(new ArrRequestError("Sonarr series lookup request failed: timeout", "timeout"));
    await expect(arrTitleSearch.search("series", "example")).rejects.toThrow("Sonarr couldn't complete the search");
  });

  it("rethrows anything that is not an Arr request failure", async () => {
    mocks.lookupMovies.mockRejectedValue(new Error("config broken"));
    const failure = arrTitleSearch.search("movie", "fight");
    await expect(failure).rejects.toThrow("config broken");
    await expect(failure).rejects.not.toBeInstanceOf(TitleSearchError);
  });
});

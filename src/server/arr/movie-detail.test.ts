import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as RadarrComponents } from "./generated/radarr";
import movieFixture from "./__fixtures__/radarr-movies.json";
import profileFixture from "./__fixtures__/radarr-qualityprofiles.json";
import creditsFixture from "./__fixtures__/radarr-credits.json";
import { ArrRequestError } from "./request";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];
type QualityProfileResource = RadarrComponents["schemas"]["QualityProfileResource"];
type CreditResource = RadarrComponents["schemas"]["CreditResource"];

const movies = movieFixture as MovieResource[];
const profiles = profileFixture as QualityProfileResource[];

const { FAKE_KEY, fakeEnv } = vi.hoisted(() => {
  const key = "fake-api-key-0123456789abcdefghi"; // 32 chars, not a real secret
  return {
    FAKE_KEY: key,
    fakeEnv: {
      RADARR_URL: "http://radarr.test:7878",
      RADARR_API_KEY: key,
      SONARR_URL: "http://sonarr.test:8989",
      SONARR_API_KEY: key,
    },
  };
});

vi.mock("@/server/env", () => ({
  env: () => fakeEnv,
}));

import { getMovieDetail, toMovieDetail } from "./movie-detail";
import { toMovieCredits } from "./movie-credits";
import { sortedProfileOptions } from "./profiles";

// movies[0] is downloaded, movies[1] is missing, movies[2] is unreleased, movies[4] has an unknown profile.
const downloaded = movies[0] as MovieResource;
const missing = movies[1] as MovieResource;
const unreleased = movies[2] as MovieResource;
const unknownProfile = movies[4] as MovieResource;

function detail(movie: MovieResource) {
  return toMovieDetail(movie, profiles);
}

describe("toMovieDetail", () => {
  it("maps a downloaded movie's header fields and file", () => {
    expect(detail({ ...downloaded, studio: "Northwind Pictures", overview: "An invented overview." })).toEqual({
      id: 1,
      title: "Starfall Protocol",
      year: 2019,
      status: "downloaded",
      overview: "An invented overview.",
      studio: "Northwind Pictures",
      runtime: 118,
      monitored: true,
      qualityProfile: "HD-1080p",
      qualityProfileId: 1,
      minimumAvailability: "released",
      fileQuality: "Bluray-1080p",
      sizeOnDisk: 12345678901,
      added: "2024-03-12T10:21:45Z",
      hasPoster: true,
      hasBackdrop: false,
      genres: ["Science Fiction"],
      certification: null,
      ratings: { imdb: 7.1, tmdb: null },
      inCinemas: null,
      digitalRelease: null,
      physicalRelease: null,
      language: null,
      imdbId: "tt0000001",
      tmdbId: 900001,
    });
  });

  it("returns null for a movie with no numeric id or no title", () => {
    expect(detail({ ...downloaded, id: undefined })).toBeNull();
    expect(detail({ ...downloaded, title: "" })).toBeNull();
    expect(detail({ ...downloaded, title: undefined })).toBeNull();
  });

  it("marks a movie that is available but has no file as missing", () => {
    expect(detail(missing)).toMatchObject({ status: "missing", fileQuality: null, sizeOnDisk: 0 });
  });

  it("marks a movie that is not yet available as unreleased", () => {
    expect(detail(unreleased)).toMatchObject({ status: "unreleased", fileQuality: null, sizeOnDisk: 0 });
  });

  it("zeroes the file quality and size when the movie is not downloaded, even if Radarr sends them", () => {
    const result = detail({ ...missing, hasFile: false, sizeOnDisk: 999, movieFile: downloaded.movieFile });
    expect(result).toMatchObject({ status: "missing", fileQuality: null, sizeOnDisk: 0 });
  });

  it("labels an unknown quality profile the same way the table does", () => {
    expect(detail(unknownProfile)?.qualityProfile).toBe("Unknown profile (#99)");
  });

  it("carries the profile id and the minimum availability the settings form starts from", () => {
    expect(detail({ ...missing, qualityProfileId: 2 })).toMatchObject({ qualityProfileId: 2 });
    expect(detail({ ...downloaded, minimumAvailability: "announced" })?.minimumAvailability).toBe("announced");
    expect(detail({ ...downloaded, minimumAvailability: "inCinemas" })?.minimumAvailability).toBe("inCinemas");
  });

  it("gives a null minimum availability for a status the form does not offer, or a missing one", () => {
    expect(detail({ ...downloaded, minimumAvailability: "tba" })?.minimumAvailability).toBeNull();
    expect(detail({ ...downloaded, minimumAvailability: "deleted" })?.minimumAvailability).toBeNull();
    expect(detail({ ...downloaded, minimumAvailability: undefined })?.minimumAvailability).toBeNull();
  });

  it("shows no year for a year of 0 or a missing year", () => {
    expect(detail({ ...downloaded, year: 0 })?.year).toBeNull();
    expect(detail({ ...downloaded, year: undefined })?.year).toBeNull();
  });

  it("shows no runtime for 0 or a missing runtime, and the minutes otherwise", () => {
    expect(detail({ ...downloaded, runtime: 0 })?.runtime).toBeNull();
    expect(detail({ ...downloaded, runtime: undefined })?.runtime).toBeNull();
    expect(detail({ ...downloaded, runtime: 125 })?.runtime).toBe(125);
  });

  it("shows no studio when Radarr sends an empty one, and an empty overview when it is missing", () => {
    expect(detail({ ...downloaded, studio: "" })?.studio).toBeNull();
    expect(detail({ ...downloaded, studio: null })?.studio).toBeNull();
    expect(detail({ ...downloaded, overview: undefined })?.overview).toBe("");
  });

  it("reports a backdrop only when a fanart cover exists", () => {
    expect(detail({ ...downloaded, images: [{ coverType: "poster" }, { coverType: "fanart" }] })?.hasBackdrop).toBe(true);
    expect(detail({ ...downloaded, images: [{ coverType: "poster" }] })?.hasBackdrop).toBe(false);
    expect(detail({ ...downloaded, images: undefined })?.hasBackdrop).toBe(false);
  });

  it("keeps up to five non-empty genres, in order", () => {
    const genres = ["Drama", "", "  ", "Thriller", "Mystery", "Crime", "Western", "Horror"];
    expect(detail({ ...downloaded, genres })?.genres).toEqual(["Drama", "Thriller", "Mystery", "Crime", "Western"]);
    expect(detail({ ...downloaded, genres: undefined })?.genres).toEqual([]);
  });

  it("shows the certification, the dates and the language only when Radarr sends them", () => {
    const result = detail({
      ...downloaded,
      certification: "PG-13",
      inCinemas: "2019-03-01T00:00:00Z",
      digitalRelease: "2019-07-02T00:00:00Z",
      physicalRelease: "",
      originalLanguage: { id: 1, name: "English" },
    });
    expect(result).toMatchObject({
      certification: "PG-13",
      inCinemas: "2019-03-01T00:00:00Z",
      digitalRelease: "2019-07-02T00:00:00Z",
      physicalRelease: null,
      language: "English",
    });
    expect(detail({ ...downloaded, certification: "", originalLanguage: { id: 1, name: "" } })).toMatchObject({
      certification: null,
      language: null,
    });
  });

  it("gives a rating only when it has votes and a positive value", () => {
    const withRatings = (ratings: MovieResource["ratings"]) => detail({ ...downloaded, ratings });
    expect(withRatings({ imdb: { value: 7.1, votes: 1200 }, tmdb: { value: 6.8, votes: 300 } })?.ratings).toEqual({
      imdb: 7.1,
      tmdb: 6.8,
    });
    expect(withRatings({ imdb: { value: 7.1, votes: 0 } })?.ratings.imdb).toBeNull();
    expect(withRatings({ imdb: { value: 0, votes: 40 } })?.ratings.imdb).toBeNull();
    expect(withRatings({ imdb: { votes: 40 } })?.ratings.imdb).toBeNull();
    expect(withRatings(undefined)?.ratings).toEqual({ imdb: null, tmdb: null });
  });

  it("keeps the IMDb id only when it has the tt-and-digits shape, and the TMDB id only when positive", () => {
    expect(detail({ ...downloaded, imdbId: "tt1234567" })).toMatchObject({ imdbId: "tt1234567" });
    expect(detail({ ...downloaded, imdbId: "https://example.invalid/tt1" })).toMatchObject({ imdbId: null });
    expect(detail({ ...downloaded, imdbId: "tt12345678901" })).toMatchObject({ imdbId: null });
    expect(detail({ ...downloaded, imdbId: null })).toMatchObject({ imdbId: null });
    expect(detail({ ...downloaded, tmdbId: 0 })).toMatchObject({ tmdbId: null });
    expect(detail({ ...downloaded, tmdbId: -3 })).toMatchObject({ tmdbId: null });
    expect(detail({ ...downloaded, tmdbId: 1.5 })).toMatchObject({ tmdbId: null });
    expect(detail({ ...downloaded, tmdbId: undefined })).toMatchObject({ tmdbId: null });
  });

  it("uses the same poster rule as the table", () => {
    expect(detail({ ...downloaded, images: [] })?.hasPoster).toBe(false);
    expect(detail({ ...downloaded, images: [{ coverType: "fanart" }] })?.hasPoster).toBe(false);
  });

  it("returns exactly the page's fields, with no file paths or other Radarr data", () => {
    const result = detail(downloaded);
    expect(Object.keys(result ?? {}).sort()).toEqual(
      [
        "added",
        "certification",
        "digitalRelease",
        "fileQuality",
        "genres",
        "hasBackdrop",
        "hasPoster",
        "id",
        "imdbId",
        "inCinemas",
        "language",
        "minimumAvailability",
        "monitored",
        "overview",
        "physicalRelease",
        "qualityProfile",
        "qualityProfileId",
        "ratings",
        "runtime",
        "sizeOnDisk",
        "status",
        "studio",
        "title",
        "tmdbId",
        "year",
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain("/invented/");
  });
});

describe("getMovieDetail", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  /** Routes the three Radarr calls. A reply may be a function that returns a Response. Credits default to an empty list. */
  function serve(movieReply: () => Response, creditsReply: () => Response = () => json([])) {
    fetchMock.mockImplementation(async (req: Request) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/v3/movie/1") return movieReply();
      if (url.pathname === "/api/v3/qualityprofile") return json(profiles);
      if (url.pathname === "/api/v3/credit") return creditsReply();
      throw new TypeError(`unexpected request to ${url.pathname}`);
    });
  }

  it("returns null when Radarr answers 404 for the movie", async () => {
    serve(() => new Response("not found", { status: 404 }));

    await expect(getMovieDetail(1)).resolves.toBeNull();
  });

  it("doesn't log a credits failure when the movie itself is gone", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    serve(
      () => new Response("not found", { status: 404 }),
      () => new Response("not found", { status: 404 }),
    );

    try {
      await expect(getMovieDetail(1)).resolves.toBeNull();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("propagates other Radarr failures instead of returning null", async () => {
    serve(() => new Response("boom", { status: 500 }));

    const error = await getMovieDetail(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).status).toBe(500);
  });

  it("fails as an invalid response when the movie reply is empty", async () => {
    serve(() => new Response("", { status: 200 }));

    const error = await getMovieDetail(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
  });

  it("returns null credits and logs one line when the credits request fails, and the rest of the page still loads", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    serve(
      () => json(downloaded),
      () => new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }),
    );

    try {
      const result = await getMovieDetail(1);

      expect(result?.credits).toBeNull();
      expect(result?.detail.title).toBe("Starfall Protocol");
      expect(result?.profiles).toEqual(sortedProfileOptions(profiles));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("Movie page: Radarr credits request failed: HTTP 500");
      expect(String(errorSpy.mock.calls[0]?.[0])).not.toContain(FAKE_KEY);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("returns the profile options sorted, from the same profile request", async () => {
    serve(() => json(downloaded));

    const result = await getMovieDetail(1);

    expect(result?.profiles).toEqual(sortedProfileOptions(profiles));
    expect(result?.profiles).toContainEqual({ id: 1, name: "HD-1080p" });
  });

  it("returns the credits from the same request set, and the detail, and sends the key in a header", async () => {
    serve(
      () => json(downloaded),
      () => json(creditsFixture),
    );

    const result = await getMovieDetail(1);

    expect(result?.detail.title).toBe("Starfall Protocol");
    expect(result?.credits).toEqual(toMovieCredits(creditsFixture as CreditResource[]));
    const requests = fetchMock.mock.calls.map((call) => call[0] as Request);
    expect(requests.map((req) => new URL(req.url).pathname).sort()).toEqual([
      "/api/v3/credit",
      "/api/v3/movie/1",
      "/api/v3/qualityprofile",
    ]);
    for (const req of requests) {
      expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
      expect(req.url).not.toContain("apikey");
      expect(req.url).not.toContain(FAKE_KEY);
      expect(req.redirect).toBe("error");
    }
  });
});

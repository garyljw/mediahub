import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as RadarrComponents } from "./generated/radarr";
import movieFixture from "./__fixtures__/radarr-movies.json";
import profileFixture from "./__fixtures__/radarr-qualityprofiles.json";
import { ArrRequestError } from "./request";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];
type QualityProfileResource = RadarrComponents["schemas"]["QualityProfileResource"];

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
      fileQuality: "Bluray-1080p",
      sizeOnDisk: 12345678901,
      added: "2024-03-12T10:21:45Z",
      hasPoster: true,
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

  it("uses the same poster rule as the table", () => {
    expect(detail({ ...downloaded, images: [] })?.hasPoster).toBe(false);
    expect(detail({ ...downloaded, images: [{ coverType: "fanart" }] })?.hasPoster).toBe(false);
  });

  it("returns exactly the page's fields, with no file paths or other Radarr data", () => {
    const result = detail(downloaded);
    expect(Object.keys(result ?? {}).sort()).toEqual(
      [
        "added",
        "fileQuality",
        "hasPoster",
        "id",
        "monitored",
        "overview",
        "qualityProfile",
        "runtime",
        "sizeOnDisk",
        "status",
        "studio",
        "title",
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

  /** Routes the two Radarr calls. A reply may be a function that returns a Response. */
  function serve(movieReply: () => Response) {
    fetchMock.mockImplementation(async (req: Request) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/v3/movie/1") return movieReply();
      if (url.pathname === "/api/v3/qualityprofile") return json(profiles);
      throw new TypeError(`unexpected request to ${url.pathname}`);
    });
  }

  it("returns null when Radarr answers 404 for the movie", async () => {
    serve(() => new Response("not found", { status: 404 }));

    await expect(getMovieDetail(1)).resolves.toBeNull();
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

  it("returns the page's detail, requests only the movie and profiles, and sends the key in a header", async () => {
    serve(() => json(downloaded));

    const result = await getMovieDetail(1);

    expect(result?.title).toBe("Starfall Protocol");
    const requests = fetchMock.mock.calls.map((call) => call[0] as Request);
    expect(requests.map((req) => new URL(req.url).pathname).sort()).toEqual([
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

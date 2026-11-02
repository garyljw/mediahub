import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { components as RadarrComponents } from "./generated/radarr";
import lookupFixture from "./__fixtures__/radarr-movie-lookup.json";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];

// movie-add.ts imports the client, which imports env. Only the pure functions are tested here.
vi.mock("@/server/env", () => ({ env: () => ({}) }));

import { ArrRequestError } from "./request";
import {
  MovieAddError,
  TMDB_POSTER_FILE,
  addMovie,
  getTmdbHeadshot,
  getTmdbPoster,
  movieAddBody,
  tmdbPosterFile,
  toLookupResults,
  type MovieAdd,
} from "./movie-add";

const clientMock = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock("./client", () => ({ radarrClient: () => clientMock }));

const hits = lookupFixture as MovieResource[];
const LIBRARY = new Set([910005]);

describe("toLookupResults", () => {
  const results = toLookupResults(hits, LIBRARY);

  it("skips items with no positive tmdbId and items with no title", () => {
    expect(results.map((r) => r.title)).toEqual(["Lantern Harbour", "Copper Meridian", "Glass Orchard", "Signal Dust"]);
    expect(results.map((r) => r.tmdbId)).not.toContain(910003);
  });

  it("keeps upstream order", () => {
    expect(results.map((r) => r.tmdbId)).toEqual([910001, 910002, 910004, 910005]);
  });

  it("returns only the six dialog fields", () => {
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(["inLibrary", "overview", "posterFile", "title", "tmdbId", "year"]);
    }
  });

  it("gives each result its TMDB poster file, or null when there is none", () => {
    expect(results.find((r) => r.tmdbId === 910001)?.posterFile).toBe("vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg");
    // No remotePoster: falls back to the poster entry's remoteUrl.
    expect(results.find((r) => r.tmdbId === 910002)?.posterFile).toBe("kqjL17yufvn9OVLyXYpvtyrFfak.jpg");
    // remotePoster is on a non-TMDB host and the poster entry is too, so there is no poster.
    expect(results.find((r) => r.tmdbId === 910004)?.posterFile).toBeNull();
    expect(results.find((r) => r.tmdbId === 910005)?.posterFile).toBeNull();
  });

  it("maps a year, using null for a missing or non-positive one", () => {
    expect(results.find((r) => r.tmdbId === 910001)?.year).toBe(2021);
    expect(results.find((r) => r.tmdbId === 910005)?.year).toBeNull();
  });

  it("uses an empty overview when Radarr sends none", () => {
    expect(results.find((r) => r.tmdbId === 910002)?.overview).toBe("");
  });

  it("keeps a short overview unchanged", () => {
    expect(results.find((r) => r.tmdbId === 910001)?.overview).toBe(hits[0].overview);
  });

  it("counts and cuts by code point, so an emoji at the cut point is kept whole", () => {
    const overview = `${"a".repeat(298)}😀bcd`; // 302 code points, 303 UTF-16 units
    const [result] = toLookupResults([{ tmdbId: 1, title: "Emoji", overview } as MovieResource], new Set());
    expect(result.overview).toBe(`${"a".repeat(298)}😀…`);
    expect(Array.from(result.overview)).toHaveLength(300);
  });

  it("leaves an overview of exactly 300 code points unchanged", () => {
    const overview = `${"a".repeat(298)}😀`; // 299 code points
    const exact = `${overview}b`; // 300 code points
    const [result] = toLookupResults([{ tmdbId: 1, title: "Exact", overview: exact } as MovieResource], new Set());
    expect(result.overview).toBe(exact);
  });

  it("cuts a long overview to 300 characters, ending with an ellipsis", () => {
    const orchard = results.find((r) => r.tmdbId === 910004);
    expect(orchard?.overview).toHaveLength(300);
    expect(orchard?.overview.endsWith("…")).toBe(true);
    expect(orchard?.overview.startsWith("A botanist inherits")).toBe(true);
  });

  it("marks movies already in the library", () => {
    expect(results.find((r) => r.tmdbId === 910005)?.inLibrary).toBe(true);
    expect(results.find((r) => r.tmdbId === 910001)?.inLibrary).toBe(false);
  });

  it("caps the list at 20 results, keeping the first 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ tmdbId: i + 1, title: `Film ${i + 1}` }) as MovieResource);
    const capped = toLookupResults(many, new Set());
    expect(capped).toHaveLength(20);
    expect(capped[0].tmdbId).toBe(1);
    expect(capped[19].tmdbId).toBe(20);
  });

  it("does not count skipped items toward the cap", () => {
    const mixed = [
      ...Array.from({ length: 25 }, () => ({ title: "No id" }) as MovieResource),
      ...Array.from({ length: 3 }, (_, i) => ({ tmdbId: i + 1, title: `Film ${i + 1}` }) as MovieResource),
    ];
    expect(toLookupResults(mixed, new Set())).toHaveLength(3);
  });
});

describe("movieAddBody", () => {
  const add: MovieAdd = {
    tmdbId: 910001,
    qualityProfileId: 4,
    rootFolderPath: "/invented/movies/",
    monitored: true,
    searchForMovie: false,
  };

  it("sends exactly the fixed field set, with explicit minimumAvailability and addOptions", () => {
    expect(movieAddBody(add, "Lantern Harbour", 2021)).toStrictEqual({
      tmdbId: 910001,
      title: "Lantern Harbour",
      year: 2021,
      qualityProfileId: 4,
      rootFolderPath: "/invented/movies/",
      monitored: true,
      minimumAvailability: "released",
      addOptions: { monitor: "movieOnly", searchForMovie: false, addMethod: "manual" },
    });
  });

  it("leaves out year when it is unknown, rather than sending null", () => {
    const body = movieAddBody(add, "Signal Dust", null);
    expect("year" in body).toBe(false);
  });

  it("maps unmonitored to monitor none", () => {
    const body = movieAddBody({ ...add, monitored: false, searchForMovie: true }, "X", null);
    expect(body.monitored).toBe(false);
    expect(body.addOptions).toStrictEqual({ monitor: "none", searchForMovie: true, addMethod: "manual" });
  });
});

describe("addMovie", () => {
  const add: MovieAdd = {
    tmdbId: 910001,
    qualityProfileId: 4,
    rootFolderPath: "/invented/movies/",
    monitored: true,
    searchForMovie: true,
  };

  beforeEach(() => {
    clientMock.GET.mockReset();
    clientMock.POST.mockReset();
  });

  it("maps a 404 from the TMDB lookup to not-found, and never checks the library or adds", async () => {
    clientMock.GET.mockResolvedValue({ data: undefined, response: new Response(null, { status: 404 }) });

    const error = await addMovie(add).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MovieAddError);
    expect((error as MovieAddError).reason).toBe("not-found");
    expect(clientMock.GET).toHaveBeenCalledTimes(1);
    expect(clientMock.POST).not.toHaveBeenCalled();
  });

  it("rethrows other lookup failures as ArrRequestError, not as not-found", async () => {
    clientMock.GET.mockResolvedValue({ data: undefined, response: new Response(null, { status: 500 }) });

    const error = await addMovie(add).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error).not.toBeInstanceOf(MovieAddError);
    expect((error as ArrRequestError).status).toBe(500);
    expect(clientMock.POST).not.toHaveBeenCalled();
  });

  it("adds the movie with the title and year from the lookup, using the fixed body", async () => {
    clientMock.GET
      .mockResolvedValueOnce({ data: { title: "Lantern Harbour", year: 2021 }, response: new Response(null, { status: 200 }) })
      .mockResolvedValueOnce({ data: [], response: new Response(null, { status: 200 }) });
    clientMock.POST.mockResolvedValue({ data: {}, response: new Response(null, { status: 201 }) });

    await expect(addMovie(add)).resolves.toEqual({ title: "Lantern Harbour", year: 2021 });
    expect(clientMock.POST.mock.calls[0][1].body).toStrictEqual(movieAddBody(add, "Lantern Harbour", 2021));
  });
});

describe("tmdbPosterFile", () => {
  const good = "https://image.tmdb.org/t/p/original/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg";
  const movie = (fields: Record<string, unknown>) => ({ title: "X", ...fields }) as MovieResource;

  it("takes the file name from remotePoster", () => {
    expect(tmdbPosterFile(movie({ remotePoster: good }))).toBe("vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg");
  });

  it("falls back to the poster entry's remoteUrl when remotePoster is missing", () => {
    expect(tmdbPosterFile(movie({ images: [{ coverType: "poster", remoteUrl: good }] }))).toBe("vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg");
  });

  it("falls back to the poster entry when remotePoster is on the wrong host", () => {
    const movieWithBadFirst = movie({
      remotePoster: "https://evil.example/t/p/original/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg",
      images: [{ coverType: "poster", remoteUrl: good }],
    });
    expect(tmdbPosterFile(movieWithBadFirst)).toBe("vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg");
  });

  it("rejects a wrong host, including a lookalike suffix", () => {
    expect(tmdbPosterFile(movie({ remotePoster: "https://image.tmdb.org.evil.example/t/p/original/abc.jpg" }))).toBeNull();
    expect(tmdbPosterFile(movie({ remotePoster: "https://evil.example/image.tmdb.org/abc.jpg" }))).toBeNull();
  });

  it("rejects plain http", () => {
    expect(tmdbPosterFile(movie({ remotePoster: "http://image.tmdb.org/t/p/original/abc.jpg" }))).toBeNull();
  });

  it("rejects a port or credentials on the TMDB host", () => {
    expect(tmdbPosterFile(movie({ remotePoster: "https://image.tmdb.org:8443/t/p/original/abc.jpg" }))).toBeNull();
    expect(tmdbPosterFile(movie({ remotePoster: "https://user@image.tmdb.org/t/p/original/abc.jpg" }))).toBeNull();
  });

  it("rejects an encoded or raw traversal in the last segment", () => {
    expect(tmdbPosterFile(movie({ remotePoster: "https://image.tmdb.org/t/p/original/..%2F..%2Fsecret.jpg" }))).toBeNull();
    expect(tmdbPosterFile(movie({ remotePoster: "https://image.tmdb.org/t/p/original/%2e%2e.jpg" }))).toBeNull();
    // WHATWG URL resolves "/../" first, so only the bare file name "abc.jpg" is left. That is safe: the
    // fetch uses the file name alone, under the fixed w342 base, so no directory can be reached.
    expect(tmdbPosterFile(movie({ remotePoster: "https://image.tmdb.org/t/p/original/../abc.jpg" }))).toBe("abc.jpg");
  });

  it("rejects a .png, a different extension, or an uppercase .JPG", () => {
    expect(tmdbPosterFile(movie({ remotePoster: "https://image.tmdb.org/t/p/original/abc.png" }))).toBeNull();
    expect(tmdbPosterFile(movie({ remotePoster: "https://image.tmdb.org/t/p/original/abc.jpg.exe" }))).toBeNull();
    expect(tmdbPosterFile(movie({ remotePoster: "https://image.tmdb.org/t/p/original/abc.JPG" }))).toBeNull();
  });

  it("returns null for a missing poster, an empty string, or an unparseable URL", () => {
    expect(tmdbPosterFile(movie({}))).toBeNull();
    expect(tmdbPosterFile(movie({ remotePoster: "" }))).toBeNull();
    expect(tmdbPosterFile(movie({ remotePoster: "not a url" }))).toBeNull();
    expect(tmdbPosterFile(movie({ images: [{ coverType: "fanart", remoteUrl: good }] }))).toBeNull();
  });

  it("accepts only names that match TMDB_POSTER_FILE", () => {
    expect(TMDB_POSTER_FILE.test("vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg")).toBe(true);
    expect(TMDB_POSTER_FILE.test("a".repeat(64) + ".jpg")).toBe(true);
    expect(TMDB_POSTER_FILE.test("a".repeat(65) + ".jpg")).toBe(false);
    expect(TMDB_POSTER_FILE.test("../a.jpg")).toBe(false);
  });
});

describe("getTmdbHeadshot", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("rejects a bad file name without fetching", async () => {
    await expect(getTmdbHeadshot("../etc.jpg")).rejects.toThrow("TMDB headshot request failed: invalid name");
    await expect(getTmdbHeadshot("abc.png")).rejects.toThrow("TMDB headshot request failed: invalid name");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the fixed w185 URL with no redirects, no headers and no Radarr key", async () => {
    fetchMock.mockResolvedValue(new Response(JPEG, { status: 200 }));
    await expect(getTmdbHeadshot("abc123.jpg")).resolves.toEqual(JPEG);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://image.tmdb.org/t/p/w185/abc123.jpg");
    expect(init.redirect).toBe("error");
    expect(init.headers).toBeUndefined();
  });

  it("maps a non-OK status to a safe ArrRequestError with the status", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    const error = await getTmdbHeadshot("abc123.jpg").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("TMDB headshot request failed: HTTP 404");
    expect((error as ArrRequestError).status).toBe(404);
  });

  it("rejects a body that is not a JPEG", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(getTmdbHeadshot("abc123.jpg")).rejects.toThrow("TMDB headshot response was not a usable image");
  });
});

describe("getTmdbPoster", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("rejects a bad file name without fetching", async () => {
    await expect(getTmdbPoster("../etc.jpg")).rejects.toThrow("TMDB poster request failed: invalid name");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the fixed w342 URL with no redirects, no headers and no Radarr key", async () => {
    fetchMock.mockResolvedValue(new Response(JPEG, { status: 200 }));
    await expect(getTmdbPoster("abc123.jpg")).resolves.toEqual(JPEG);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://image.tmdb.org/t/p/w342/abc123.jpg");
    expect(init.redirect).toBe("error");
    expect(init.headers).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("cancels the body of a failed response so the socket is released", async () => {
    const cancel = vi.fn(async () => {});
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 404 }));
    await expect(getTmdbPoster("abc123.jpg")).rejects.toThrow("TMDB poster request failed: HTTP 404");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("still reports the status when cancelling the body throws", async () => {
    const cancel = vi.fn(async () => {
      throw new Error("socket already closed");
    });
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 500 }));
    const error = await getTmdbPoster("abc123.jpg").catch((e: unknown) => e);
    expect((error as ArrRequestError).message).toBe("TMDB poster request failed: HTTP 500");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("maps a non-OK status to a safe ArrRequestError with the status", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    const error = await getTmdbPoster("abc123.jpg").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("TMDB poster request failed: HTTP 404");
    expect((error as ArrRequestError).status).toBe(404);
  });

  it("rejects a body that is not a JPEG", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(getTmdbPoster("abc123.jpg")).rejects.toThrow("TMDB poster response was not a usable image");
  });

  it("reports a network failure without the underlying error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed: https://image.tmdb.org/..."));
    const error = await getTmdbPoster("abc123.jpg").catch((e: unknown) => e);
    expect((error as ArrRequestError).message).toBe("TMDB poster request failed: network error");
  });
});

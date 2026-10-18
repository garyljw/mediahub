import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as RadarrComponents } from "./generated/radarr";
import movieFixture from "./__fixtures__/radarr-movies.json";
import profileFixture from "./__fixtures__/radarr-qualityprofiles.json";
import { ARR_TIMEOUT_MS, ArrRequestError } from "./request";
import { MAX_POSTER_BYTES } from "./poster";

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

const envMock = vi.hoisted(() => ({ fail: false }));

vi.mock("@/server/env", () => ({
  env: () => {
    if (envMock.fail) throw new Error("Invalid environment configuration: RADARR_URL");
    return fakeEnv;
  },
}));

import {
  DELETE_TIMEOUT_MS,
  deleteMovies,
  editMovies,
  getMoviePoster,
  listMovies,
  listQualityProfiles,
  refreshMovies,
  searchMovieReleases,
  toMovieRows,
} from "./movies";

const ALLOWED_KEYS = [
  "added",
  "fileQuality",
  "hasPoster",
  "id",
  "monitored",
  "qualityProfile",
  "qualityProfileId",
  "sizeOnDisk",
  "sortTitle",
  "status",
  "title",
  "year",
].sort();

describe("toMovieRows", () => {
  const rows = toMovieRows(movies, profiles);

  it("skips movies with no id or no title", () => {
    expect(rows.map((r) => r.id)).not.toContain(undefined);
    expect(rows.map((r) => r.title)).not.toContain("No Id Film");
    expect(rows.map((r) => r.title)).not.toContain(null);
    expect(rows).toHaveLength(6);
  });

  it("keeps upstream order (sorting is the table's job) and falls back to the title for sortTitle", () => {
    const expectedIds = movies.filter((m) => typeof m.id === "number" && m.title).map((m) => m.id);
    expect(rows.map((r) => r.id)).toEqual(expectedIds);
    expect(rows.find((r) => r.id === 6)?.sortTitle).toBe("ampersand & co");
  });

  it("maps a downloaded movie with its file quality and size", () => {
    expect(rows.find((r) => r.id === 1)).toEqual({
      id: 1,
      title: "Starfall Protocol",
      year: 2019,
      status: "downloaded",
      monitored: true,
      qualityProfileId: 1,
      qualityProfile: "HD-1080p",
      fileQuality: "Bluray-1080p",
      sizeOnDisk: 12345678901,
      added: "2024-03-12T10:21:45Z",
      sortTitle: "starfall protocol",
      hasPoster: true,
    });
  });

  it("maps a monitored missing movie with no file quality and zero size", () => {
    expect(rows.find((r) => r.id === 2)).toEqual({
      id: 2,
      title: "Lantern Road",
      year: 2021,
      status: "missing",
      monitored: true,
      qualityProfileId: 2,
      qualityProfile: "Any",
      fileQuality: null,
      sizeOnDisk: 0,
      added: "2024-05-01T08:00:00Z",
      sortTitle: "lantern road",
      hasPoster: false,
    });
  });

  it("maps an unreleased movie (isAvailable false) as unreleased", () => {
    const row = rows.find((r) => r.id === 3);
    expect(row?.status).toBe("unreleased");
    expect(row?.fileQuality).toBeNull();
    expect(row?.sizeOnDisk).toBe(0);
  });

  it("maps an unmonitored downloaded movie", () => {
    expect(rows.find((r) => r.id === 4)).toMatchObject({
      status: "downloaded",
      monitored: false,
      fileQuality: "WEBDL-720p",
      sizeOnDisk: 1610612736,
      added: "2023-11-02T12:00:00.250Z",
    });
  });

  it("labels a profile id that is not in the profile list as Unknown, with its id", () => {
    expect(rows.find((r) => r.id === 5)).toMatchObject({
      qualityProfileId: 99,
      qualityProfile: "Unknown profile (#99)",
    });
  });

  it("sets hasPoster only when a poster cover exists", () => {
    const base = movies[0];
    const withImages = (images: MovieResource["images"]) => toMovieRows([{ ...base, id: 900, title: "Poster Test", images }], profiles)[0];
    expect(withImages([{ coverType: "poster", url: "x", remoteUrl: "x" }]).hasPoster).toBe(true);
    expect(withImages([{ coverType: "fanart", url: "x", remoteUrl: "x" }]).hasPoster).toBe(false);
    expect(withImages([])).toMatchObject({ hasPoster: false });
    expect(withImages(null).hasPoster).toBe(false);
    expect(withImages(undefined).hasPoster).toBe(false);
  });

  it("maps a null year and a null sortTitle", () => {
    expect(rows.find((r) => r.id === 6)).toMatchObject({
      year: null,
      sortTitle: "ampersand & co",
      status: "missing",
    });
  });

  it("returns exactly the allowed keys on every row", () => {
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(ALLOWED_KEYS);
    }
  });

  it("does not carry paths, images, URLs, overviews or other upstream fields", () => {
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("/invented");
    expect(serialized).not.toContain("example.invalid");
    expect(serialized).not.toContain("Invented overview");
    expect(serialized).not.toContain("tt0000001");
    expect(serialized).not.toContain("Science Fiction");
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

/** Routes the two Radarr calls to the given replies. A reply may throw to simulate a network error. */
function serve(movieReply: () => Response, profileReply: () => Response) {
  fetchMock.mockImplementation(async (req: Request) => {
    const path = new URL(req.url).pathname;
    if (path === "/api/v3/movie") return movieReply();
    if (path === "/api/v3/qualityprofile") return profileReply();
    throw new TypeError(`unexpected request to ${path}`);
  });
}

function requestAt(call: number): Request {
  return fetchMock.mock.calls[call][0] as Request;
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (e: unknown) => e as Error,
  );
}

describe("listMovies", () => {
  it("fetches both endpoints with the key in a header and returns rows and profile options", async () => {
    serve(
      () => json(movies),
      () => json(profiles),
    );

    const result = await listMovies();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const paths = [requestAt(0), requestAt(1)].map((req) => new URL(req.url).pathname).sort();
    expect(paths).toEqual(["/api/v3/movie", "/api/v3/qualityprofile"]);
    for (let i = 0; i < 2; i++) {
      const req = requestAt(i);
      expect(req.method).toBe("GET");
      expect(new URL(req.url).host).toBe("radarr.test:7878");
      expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
      expect(req.redirect).toBe("error");
      expect(req.url).not.toContain("apikey");
      expect(req.url).not.toContain(FAKE_KEY);
    }

    expect(result.rows).toHaveLength(6);
    expect(result.profiles).toEqual([
      { id: 2, name: "Any" },
      { id: 1, name: "HD-1080p" },
      { id: 3, name: "Ultra-HD" },
    ]);
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  });

  it("throws on HTTP 500 from the movie list without leaking the key, host or body", async () => {
    serve(
      () => new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }),
      () => json(profiles),
    );

    const error = await rejectionOf(listMovies());

    expect(error.message).toBe("Radarr movie request failed: HTTP 500");
    // The page shows its friendly error only for ArrRequestError and rethrows anything else.
    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("radarr.test");
  });

  it("throws on HTTP 500 from the profile list without leaking the key, host or body", async () => {
    serve(
      () => json(movies),
      () => new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }),
    );

    const error = await rejectionOf(listMovies());

    expect(error.message).toBe("Radarr quality profile request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("radarr.test");
  });

  it("throws a generic error on network failure without exposing the host", async () => {
    serve(
      () => {
        throw new TypeError("fetch failed for http://radarr.test:7878/api/v3/movie");
      },
      () => json(profiles),
    );

    const error = await rejectionOf(listMovies());

    expect(error.message).toBe("Radarr movie request failed: network error");
    expect(error.message).not.toContain("radarr.test");
    expect(error.message).not.toContain("7878");
  });
});

describe("listMovies failure kinds", () => {
  it("gives each request a 15 second timeout signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    serve(
      () => json(movies),
      () => json(profiles),
    );
    await listMovies();
    expect(ARR_TIMEOUT_MS).toBe(15_000);
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledWith(ARR_TIMEOUT_MS);
    // The signal reaches the actual request, so the timeout covers the fetch.
    expect(requestAt(0).signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it("reports a timeout as timed out", async () => {
    serve(
      () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
      () => json(profiles),
    );
    const error = await rejectionOf(listMovies());
    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Radarr movie request failed: timed out");
    expect((error as ArrRequestError).kind).toBe("timeout");
  });

  it("reports a non-JSON OK body as an invalid response, without the body", async () => {
    serve(
      () => new Response("<html>login at http://radarr.test:7878</html>", { status: 200, headers: { "Content-Type": "application/json" } }),
      () => json(profiles),
    );
    const error = await rejectionOf(listMovies());
    expect(error.message).toBe("Radarr movie request failed: invalid response");
    expect(error.message).not.toContain("radarr.test");
  });
});

describe("env errors", () => {
  afterEach(() => {
    envMock.fail = false;
  });

  it("listMovies surfaces config errors instead of reporting a network error", async () => {
    vi.resetModules(); // drop memoized clients
    envMock.fail = true;
    const mod = await import("./movies");

    await expect(mod.listMovies()).rejects.toThrow("Invalid environment configuration");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The only request the editor functions may make: one call to the movie editor.
function serveEditor(reply: () => Response) {
  fetchMock.mockImplementation(async (req: Request) => {
    const path = new URL(req.url).pathname;
    if (path === "/api/v3/movie/editor") return reply();
    throw new TypeError(`unexpected request to ${path}`);
  });
}

async function sentBody(): Promise<Record<string, unknown>> {
  const req = requestAt(0);
  return JSON.parse(await req.text()) as Record<string, unknown>;
}

describe("editMovies", () => {
  it("sends a PUT to the movie editor with the key in a header and only the given fields", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    await editMovies({ movieIds: [1, 2], qualityProfileId: 3, monitored: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("PUT");
    expect(new URL(req.url).pathname).toBe("/api/v3/movie/editor");
    expect(new URL(req.url).search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody()).toEqual({ movieIds: [1, 2], qualityProfileId: 3, monitored: false });
  });

  it("leaves out undefined fields instead of sending them", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    await editMovies({ movieIds: [7], monitored: true });

    const body = await sentBody();
    expect(body).toEqual({ movieIds: [7], monitored: true });
    expect("qualityProfileId" in body).toBe(false);
  });

  it("sends only movieIds when nothing else is set", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    await editMovies({ movieIds: [4] });

    expect(await sentBody()).toEqual({ movieIds: [4] });
  });

  it("never sends other editor fields", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    await editMovies({ movieIds: [1], qualityProfileId: 2, monitored: true });

    const keys = Object.keys(await sentBody()).sort();
    expect(keys).toEqual(["monitored", "movieIds", "qualityProfileId"]);
  });

  it("throws ArrRequestError on HTTP 500 without leaking the key, host or body", async () => {
    serveEditor(() => new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }));

    const error = await rejectionOf(editMovies({ movieIds: [1], monitored: true }));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Radarr movie edit request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("radarr.test");
  });

  it("throws ArrRequestError on a network failure without exposing the host", async () => {
    serveEditor(() => {
      throw new TypeError("fetch failed for http://radarr.test:7878/api/v3/movie/editor");
    });

    const error = await rejectionOf(editMovies({ movieIds: [1], monitored: true }));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Radarr movie edit request failed: network error");
    expect(error.message).not.toContain("radarr.test");
  });
});

describe("deleteMovies", () => {
  it("allows a longer timeout than reads, because deleting files can be slow", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    serveEditor(() => new Response(null, { status: 200 }));
    await deleteMovies({ movieIds: [1], deleteFiles: true, addImportExclusion: false });
    expect(timeout).toHaveBeenCalledWith(DELETE_TIMEOUT_MS);
    expect(DELETE_TIMEOUT_MS).toBeGreaterThan(ARR_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it("sends a DELETE to the movie editor with the key in a header and the exact body", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    await deleteMovies({ movieIds: [1, 2], deleteFiles: true, addImportExclusion: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("DELETE");
    expect(new URL(req.url).pathname).toBe("/api/v3/movie/editor");
    expect(new URL(req.url).search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody()).toStrictEqual({ movieIds: [1, 2], deleteFiles: true, addImportExclusion: false });
  });

  it.each([
    ["both false", { deleteFiles: false, addImportExclusion: false }],
    ["files only", { deleteFiles: true, addImportExclusion: false }],
    ["exclusion only", { deleteFiles: false, addImportExclusion: true }],
    ["both true", { deleteFiles: true, addImportExclusion: true }],
  ])("always sends both booleans explicitly (%s)", async (_name, flags) => {
    serveEditor(() => new Response(null, { status: 200 }));

    await deleteMovies({ movieIds: [9], ...flags });

    const body = await sentBody();
    expect(body).toStrictEqual({ movieIds: [9], ...flags });
    expect(typeof body.deleteFiles).toBe("boolean");
    expect(typeof body.addImportExclusion).toBe("boolean");
  });

  it("never sends other editor fields, even when the caller passes extras", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    // A caller that passes extra keys (the type forbids it) must still not get them forwarded.
    const sneaky = { movieIds: [1], deleteFiles: false, addImportExclusion: false, moveFiles: true, tags: [3] };
    await deleteMovies(sneaky as Parameters<typeof deleteMovies>[0]);

    expect(Object.keys(await sentBody()).sort()).toEqual(["addImportExclusion", "deleteFiles", "movieIds"]);
  });

  it("throws ArrRequestError on HTTP 500 without leaking the key, host or body", async () => {
    serveEditor(() => new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }));

    const error = await rejectionOf(deleteMovies({ movieIds: [1], deleteFiles: false, addImportExclusion: false }));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Radarr movie delete request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("radarr.test");
  });

  it("throws ArrRequestError on a network failure without exposing the host", async () => {
    serveEditor(() => {
      throw new TypeError("fetch failed for http://radarr.test:7878/api/v3/movie/editor");
    });

    const error = await rejectionOf(deleteMovies({ movieIds: [1], deleteFiles: true, addImportExclusion: true }));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Radarr movie delete request failed: network error");
    expect(error.message).not.toContain("radarr.test");
  });
});

describe("listQualityProfiles", () => {
  it("returns the same usable, sorted options that listMovies returns as profiles", async () => {
    serve(
      () => json(movies),
      () => json(profiles),
    );

    const options = await listQualityProfiles();
    const { profiles: fromMovies } = await listMovies();

    expect(options).toEqual([
      { id: 2, name: "Any" },
      { id: 1, name: "HD-1080p" },
      { id: 3, name: "Ultra-HD" },
    ]);
    expect(options).toEqual(fromMovies);
  });
});

describe("getMoviePoster", () => {
  const POSTER_PATH = "/api/v3/mediacover/42/poster-250.jpg";

  function servePoster(reply: () => Response) {
    fetchMock.mockImplementation(async (req: Request) => {
      if (new URL(req.url).pathname === POSTER_PATH) return reply();
      throw new TypeError(`unexpected request to ${new URL(req.url).pathname}`);
    });
  }

  it("requests exactly the fixed poster file with the key in a header and not in the URL", async () => {
    servePoster(() => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 }));

    await getMoviePoster(42);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("GET");
    expect(req.url).toBe("http://radarr.test:7878/api/v3/mediacover/42/poster-250.jpg");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
    expect(req.url).not.toContain(FAKE_KEY);
  });

  it("returns the image bytes", async () => {
    servePoster(() => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200 }));

    const bytes = await getMoviePoster(42);

    expect(Array.from(bytes)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it("joins a body that arrives in several chunks", async () => {
    const chunks = [new Uint8Array([0xff, 0xd8]), new Uint8Array([0xff, 0xe0, 0x01])];
    servePoster(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk);
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );

    expect(Array.from(await getMoviePoster(42))).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x01]);
  });

  it("throws an invalid ArrRequestError for a body that is not a JPEG, such as an HTML login page", async () => {
    servePoster(() => new Response("<!doctype html><title>Login</title>", { status: 200 }));

    const error = await rejectionOf(getMoviePoster(42));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
  });

  it("stops reading an oversized body once it passes the cap", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0xff);
    let pulls = 0;
    let cancelled = false;
    servePoster(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              controller.enqueue(chunk);
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200 },
        ),
    );

    const error = await rejectionOf(getMoviePoster(42));

    expect((error as ArrRequestError).kind).toBe("invalid");
    expect(cancelled).toBe(true);
    // 2 MiB cap with 1 MiB chunks: the third chunk goes over. Allow one extra for stream read-ahead.
    expect(pulls).toBeLessThanOrEqual(4);
  });

  it("throws an invalid ArrRequestError for an empty body", async () => {
    servePoster(() => new Response(new Uint8Array(0), { status: 200 }));

    const error = await rejectionOf(getMoviePoster(42));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
    expect(error.message).toBe("Radarr poster response was not a usable image");
  });

  it("throws an invalid ArrRequestError for a body larger than MAX_POSTER_BYTES", async () => {
    // A valid JPEG start, so only the size cap can reject it.
    const body = new Uint8Array(MAX_POSTER_BYTES + 1);
    body.set([0xff, 0xd8, 0xff]);
    servePoster(() => new Response(body, { status: 200 }));

    const error = await rejectionOf(getMoviePoster(42));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
  });

  it("accepts a JPEG of exactly MAX_POSTER_BYTES", async () => {
    const body = new Uint8Array(MAX_POSTER_BYTES);
    body.set([0xff, 0xd8, 0xff]);
    servePoster(() => new Response(body, { status: 200 }));

    expect((await getMoviePoster(42)).byteLength).toBe(MAX_POSTER_BYTES);
  });

  it("reports a body that fails mid-read as a network error, without the underlying message", async () => {
    servePoster(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
              controller.error(new TypeError(`socket reset by http://radarr.test:7878 ${FAKE_KEY}`));
            },
          }),
          { status: 200 },
        ),
    );

    const error = await rejectionOf(getMoviePoster(42));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("network");
    expect(error.message).not.toContain("radarr.test");
    expect(error.message).not.toContain(FAKE_KEY);
  });

  it("throws ArrRequestError with HTTP 404 for a missing poster", async () => {
    servePoster(() => new Response(`not found at http://radarr.test:7878 ${FAKE_KEY}`, { status: 404 }));

    const error = await rejectionOf(getMoviePoster(42));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Radarr poster request failed: HTTP 404");
    expect(error.message).not.toContain("radarr.test");
    expect(error.message).not.toContain(FAKE_KEY);
  });
});

describe("searchMovieReleases", () => {
  function serveCommand(respond: () => Response) {
    fetchMock.mockImplementation(async () => respond());
  }

  it("POSTs the MoviesSearch command with the key in a header and exactly name and movieIds", async () => {
    serveCommand(() => Response.json({ id: 1, name: "MoviesSearch" }));

    await searchMovieReleases([3, 5]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/api/v3/command");
    expect(new URL(req.url).search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody()).toStrictEqual({ name: "MoviesSearch", movieIds: [3, 5] });
  });

  it("throws ArrRequestError on HTTP 500 without leaking the key, host or body", async () => {
    serveCommand(() => new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }));

    const error = await rejectionOf(searchMovieReleases([1]));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Radarr movie search command request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("radarr.test");
  });
});

describe("refreshMovies", () => {
  function serveCommand(respond: () => Response) {
    fetchMock.mockImplementation(async () => respond());
  }

  it("POSTs the RefreshMovie command with the key in a header and exactly name and movieIds", async () => {
    serveCommand(() => Response.json({ id: 1, name: "RefreshMovie" }));

    await refreshMovies([3, 5]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/api/v3/command");
    expect(new URL(req.url).search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody()).toStrictEqual({ name: "RefreshMovie", movieIds: [3, 5] });
  });

  it("throws ArrRequestError on HTTP 500 without leaking the key, host or body", async () => {
    serveCommand(() => new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }));

    const error = await rejectionOf(refreshMovies([1]));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Radarr movie refresh command request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("radarr.test");
  });
});

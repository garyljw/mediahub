import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as RadarrComponents } from "./generated/radarr";
import movieFixture from "./__fixtures__/radarr-movies.json";
import profileFixture from "./__fixtures__/radarr-qualityprofiles.json";
import { ARR_TIMEOUT_MS, ArrRequestError } from "./request";

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

import { editMovies, listMovies, listQualityProfiles, toMovieRows } from "./movies";

const ALLOWED_KEYS = [
  "added",
  "fileQuality",
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

describe("editMovies", () => {
  // The only request this function may make: one PUT to the movie editor.
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

import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as SonarrComponents } from "./generated/sonarr";
import seriesFixture from "./__fixtures__/sonarr-series.json";
import profileFixture from "./__fixtures__/sonarr-qualityprofiles.json";
import { DELETE_TIMEOUT_MS } from "./movies";
import { ARR_TIMEOUT_MS, ArrRequestError } from "./request";
import { MAX_POSTER_BYTES } from "./poster";

type SeriesResource = SonarrComponents["schemas"]["SeriesResource"];
type QualityProfileResource = SonarrComponents["schemas"]["QualityProfileResource"];

const series = seriesFixture as SeriesResource[];
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
    if (envMock.fail) throw new Error("Invalid environment configuration: SONARR_URL");
    return fakeEnv;
  },
}));

import {
  deleteSeries,
  editSeries,
  getSeriesPoster,
  listSeries,
  listSeriesQualityProfiles,
  toSeriesRows,
} from "./series";

const ALLOWED_KEYS = [
  "added",
  "episodeCount",
  "episodeFileCount",
  "hasPoster",
  "id",
  "monitored",
  "network",
  "qualityProfile",
  "qualityProfileId",
  "seasonCount",
  "sizeOnDisk",
  "sortTitle",
  "status",
  "title",
  "year",
].sort();

describe("toSeriesRows", () => {
  const rows = toSeriesRows(series, profiles);

  it("skips series with no id or no title", () => {
    expect(rows.map((r) => r.title)).not.toContain("No Id Show");
    expect(rows.map((r) => r.id)).not.toContain(undefined);
    expect(rows).toHaveLength(7);
  });

  it("keeps upstream order (sorting is the table's job) and falls back to the title for sortTitle", () => {
    const expectedIds = series.filter((s) => typeof s.id === "number" && s.title).map((s) => s.id);
    expect(rows.map((r) => r.id)).toEqual(expectedIds);
    expect(rows.find((r) => r.id === 3)?.sortTitle).toBe("coming soon show");
  });

  it("maps a continuing series with its network and counts", () => {
    expect(rows.find((r) => r.id === 1)).toEqual({
      id: 1,
      title: "Harbour Lights",
      year: 2018,
      status: "continuing",
      monitored: true,
      qualityProfileId: 1,
      qualityProfile: "HD-1080p",
      network: "Northwind TV",
      episodeFileCount: 24,
      episodeCount: 24,
      seasonCount: 3,
      sizeOnDisk: 48318382080,
      added: "2024-02-10T09:00:00Z",
      sortTitle: "harbour lights",
      hasPoster: true,
    });
  });

  it("maps an ended series, with a null network and a sortTitle from the upstream field", () => {
    expect(rows.find((r) => r.id === 2)).toMatchObject({
      status: "ended",
      monitored: false,
      network: null,
      episodeFileCount: 10,
      episodeCount: 12,
      seasonCount: 2,
      sortTitle: "long quiet, the",
      hasPoster: true,
    });
  });

  it("maps an upcoming series with no files as upcoming, with zero counts", () => {
    expect(rows.find((r) => r.id === 3)).toMatchObject({
      status: "upcoming",
      network: "Lakeside",
      year: 2026,
      episodeFileCount: 0,
      episodeCount: 0,
      sizeOnDisk: 0,
    });
  });

  it("maps a 'deleted' status to ended, because the table has no state for it", () => {
    expect(rows.find((r) => r.id === 4)?.status).toBe("ended");
  });

  it("maps a missing statistics object to zero counts and zero size", () => {
    expect(rows.find((r) => r.id === 5)).toMatchObject({
      status: "continuing",
      episodeFileCount: 0,
      episodeCount: 0,
      seasonCount: 0,
      sizeOnDisk: 0,
    });
  });

  it("does not use totalEpisodeCount for the episode count", () => {
    // The fixture has totalEpisodeCount 30 for series 1 and 8 for series 3. Neither may become episodeCount.
    expect(rows.find((r) => r.id === 1)?.episodeCount).toBe(24);
    expect(rows.find((r) => r.id === 3)?.episodeCount).toBe(0);
  });

  it("labels a profile id that is not in the profile list as Unknown, with its id", () => {
    expect(rows.find((r) => r.id === 6)).toMatchObject({
      qualityProfileId: 99,
      qualityProfile: "Unknown profile (#99)",
    });
  });

  it("maps a year of zero or less to null", () => {
    expect(rows.find((r) => r.id === 8)).toMatchObject({ year: null, hasPoster: false });
  });

  it("sets hasPoster only when a poster cover exists", () => {
    const base = series[0];
    const withImages = (images: SeriesResource["images"]) =>
      toSeriesRows([{ ...base, id: 900, title: "Poster Test", images }], profiles)[0];
    expect(withImages([{ coverType: "poster", url: "x", remoteUrl: "x" }]).hasPoster).toBe(true);
    expect(withImages([{ coverType: "fanart", url: "x", remoteUrl: "x" }]).hasPoster).toBe(false);
    expect(withImages([])).toMatchObject({ hasPoster: false });
    expect(withImages(null).hasPoster).toBe(false);
    expect(withImages(undefined).hasPoster).toBe(false);
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
    expect(serialized).not.toContain("tt0000011");
    expect(serialized).not.toContain("Drama");
    expect(serialized).not.toContain("INVENTED");
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

/** Routes the two Sonarr calls to the given replies. A reply may throw to simulate a network error. */
function serve(seriesReply: () => Response, profileReply: () => Response) {
  fetchMock.mockImplementation(async (req: Request) => {
    const path = new URL(req.url).pathname;
    if (path === "/api/v3/series") return seriesReply();
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

describe("listSeries", () => {
  it("fetches both endpoints with the key in a header and returns rows and profile options", async () => {
    serve(
      () => json(series),
      () => json(profiles),
    );

    const result = await listSeries();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const paths = [requestAt(0), requestAt(1)].map((req) => new URL(req.url).pathname).sort();
    expect(paths).toEqual(["/api/v3/qualityprofile", "/api/v3/series"]);
    for (let i = 0; i < 2; i++) {
      const req = requestAt(i);
      expect(req.method).toBe("GET");
      expect(new URL(req.url).host).toBe("sonarr.test:8989");
      expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
      expect(req.redirect).toBe("error");
      expect(req.url).not.toContain("apikey");
      expect(req.url).not.toContain(FAKE_KEY);
    }

    expect(result.rows).toHaveLength(7);
    expect(result.profiles).toEqual([
      { id: 2, name: "Any" },
      { id: 1, name: "HD-1080p" },
      { id: 3, name: "Ultra-HD" },
    ]);
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  });

  it("throws on HTTP 500 from the series list without leaking the key, host or body", async () => {
    serve(
      () => new Response(`boom ${FAKE_KEY} at http://sonarr.test:8989`, { status: 500 }),
      () => json(profiles),
    );

    const error = await rejectionOf(listSeries());

    expect(error.message).toBe("Sonarr series request failed: HTTP 500");
    // The page shows its friendly error only for ArrRequestError and rethrows anything else.
    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("sonarr.test");
  });

  it("throws on HTTP 500 from the profile list without leaking the key, host or body", async () => {
    serve(
      () => json(series),
      () => new Response(`boom ${FAKE_KEY} at http://sonarr.test:8989`, { status: 500 }),
    );

    const error = await rejectionOf(listSeries());

    expect(error.message).toBe("Sonarr quality profile request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("sonarr.test");
  });

  it("throws a generic error on network failure without exposing the host", async () => {
    serve(
      () => {
        throw new TypeError("fetch failed for http://sonarr.test:8989/api/v3/series");
      },
      () => json(profiles),
    );

    const error = await rejectionOf(listSeries());

    expect(error.message).toBe("Sonarr series request failed: network error");
    expect(error.message).not.toContain("sonarr.test");
    expect(error.message).not.toContain("8989");
  });

  it("reports a timeout as timed out", async () => {
    serve(
      () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
      () => json(profiles),
    );
    const error = await rejectionOf(listSeries());
    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr series request failed: timed out");
    expect((error as ArrRequestError).kind).toBe("timeout");
  });

  it("gives each request the normal read timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    serve(
      () => json(series),
      () => json(profiles),
    );
    await listSeries();
    expect(ARR_TIMEOUT_MS).toBe(15_000);
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledWith(ARR_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it("reports a non-JSON OK body as an invalid response, without the body", async () => {
    serve(
      () => new Response("<html>login at http://sonarr.test:8989</html>", { status: 200, headers: { "Content-Type": "application/json" } }),
      () => json(profiles),
    );
    const error = await rejectionOf(listSeries());
    expect(error.message).toBe("Sonarr series request failed: invalid response");
    expect(error.message).not.toContain("sonarr.test");
  });
});

describe("env errors", () => {
  afterEach(() => {
    envMock.fail = false;
  });

  it("listSeries surfaces config errors instead of reporting a network error", async () => {
    vi.resetModules(); // drop memoized clients
    envMock.fail = true;
    const mod = await import("./series");

    await expect(mod.listSeries()).rejects.toThrow("Invalid environment configuration");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("listSeriesQualityProfiles", () => {
  it("returns the same usable, sorted options that listSeries returns as profiles", async () => {
    serve(
      () => json(series),
      () => json(profiles),
    );

    const options = await listSeriesQualityProfiles();
    const { profiles: fromSeries } = await listSeries();

    expect(options).toEqual([
      { id: 2, name: "Any" },
      { id: 1, name: "HD-1080p" },
      { id: 3, name: "Ultra-HD" },
    ]);
    expect(options).toEqual(fromSeries);
  });
});

// The only request the editor functions may make: one call to the series editor.
function serveEditor(reply: () => Response) {
  fetchMock.mockImplementation(async (req: Request) => {
    const path = new URL(req.url).pathname;
    if (path === "/api/v3/series/editor") return reply();
    throw new TypeError(`unexpected request to ${path}`);
  });
}

async function sentBody(): Promise<Record<string, unknown>> {
  const req = requestAt(0);
  return JSON.parse(await req.text()) as Record<string, unknown>;
}

describe("editSeries", () => {
  it("sends a PUT to the series editor with the key in a header and only the given fields", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    await editSeries({ seriesIds: [1, 2], qualityProfileId: 3, monitored: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("PUT");
    expect(new URL(req.url).pathname).toBe("/api/v3/series/editor");
    expect(new URL(req.url).search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody()).toStrictEqual({ seriesIds: [1, 2], qualityProfileId: 3, monitored: false });
  });

  it("leaves out undefined fields instead of sending them", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    await editSeries({ seriesIds: [7], monitored: true });

    const body = await sentBody();
    expect(body).toStrictEqual({ seriesIds: [7], monitored: true });
    expect("qualityProfileId" in body).toBe(false);
  });

  it("sends only seriesIds when nothing else is set", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    await editSeries({ seriesIds: [4] });

    expect(await sentBody()).toStrictEqual({ seriesIds: [4] });
  });

  it("never sends other editor fields, even when the caller passes extras", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    const sneaky = {
      seriesIds: [1],
      qualityProfileId: 2,
      monitored: true,
      moveFiles: true,
      rootFolderPath: "/invented/tv/",
      tags: [3],
      seriesType: "anime",
      monitorNewItems: "all",
    };
    await editSeries(sneaky as Parameters<typeof editSeries>[0]);

    expect(Object.keys(await sentBody()).sort()).toEqual(["monitored", "qualityProfileId", "seriesIds"]);
  });

  it("throws ArrRequestError on HTTP 500 without leaking the key, host or body", async () => {
    serveEditor(() => new Response(`boom ${FAKE_KEY} at http://sonarr.test:8989`, { status: 500 }));

    const error = await rejectionOf(editSeries({ seriesIds: [1], monitored: true }));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr series edit request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("sonarr.test");
  });

  it("throws ArrRequestError on a network failure without exposing the host", async () => {
    serveEditor(() => {
      throw new TypeError("fetch failed for http://sonarr.test:8989/api/v3/series/editor");
    });

    const error = await rejectionOf(editSeries({ seriesIds: [1], monitored: true }));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr series edit request failed: network error");
    expect(error.message).not.toContain("sonarr.test");
  });
});

describe("deleteSeries", () => {
  it("allows a longer timeout than reads, because deleting files can be slow", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    serveEditor(() => new Response(null, { status: 200 }));
    await deleteSeries({ seriesIds: [1], deleteFiles: true, addImportListExclusion: false });
    expect(timeout).toHaveBeenCalledWith(DELETE_TIMEOUT_MS);
    expect(DELETE_TIMEOUT_MS).toBeGreaterThan(ARR_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it("sends a DELETE to the series editor with the key in a header and the exact body", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    await deleteSeries({ seriesIds: [1, 2], deleteFiles: true, addImportListExclusion: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("DELETE");
    expect(new URL(req.url).pathname).toBe("/api/v3/series/editor");
    expect(new URL(req.url).search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody()).toStrictEqual({ seriesIds: [1, 2], deleteFiles: true, addImportListExclusion: false });
  });

  it.each([
    ["both false", { deleteFiles: false, addImportListExclusion: false }],
    ["files only", { deleteFiles: true, addImportListExclusion: false }],
    ["exclusion only", { deleteFiles: false, addImportListExclusion: true }],
    ["both true", { deleteFiles: true, addImportListExclusion: true }],
  ])("always sends both booleans explicitly (%s)", async (_name, flags) => {
    serveEditor(() => new Response(null, { status: 200 }));

    await deleteSeries({ seriesIds: [9], ...flags });

    const body = await sentBody();
    expect(body).toStrictEqual({ seriesIds: [9], ...flags });
    expect(typeof body.deleteFiles).toBe("boolean");
    expect(typeof body.addImportListExclusion).toBe("boolean");
  });

  it("never sends other editor fields, even when the caller passes extras", async () => {
    serveEditor(() => new Response(null, { status: 200 }));

    // A caller that passes extra keys (the type forbids it) must still not get them forwarded.
    const sneaky = { seriesIds: [1], deleteFiles: false, addImportListExclusion: false, moveFiles: true, tags: [3], addImportExclusion: true };
    await deleteSeries(sneaky as Parameters<typeof deleteSeries>[0]);

    expect(Object.keys(await sentBody()).sort()).toEqual(["addImportListExclusion", "deleteFiles", "seriesIds"]);
  });

  it("throws ArrRequestError on HTTP 500 without leaking the key, host or body", async () => {
    serveEditor(() => new Response(`boom ${FAKE_KEY} at http://sonarr.test:8989`, { status: 500 }));

    const error = await rejectionOf(deleteSeries({ seriesIds: [1], deleteFiles: false, addImportListExclusion: false }));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr series delete request failed: HTTP 500");
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("sonarr.test");
  });

  it("throws ArrRequestError on a network failure without exposing the host", async () => {
    serveEditor(() => {
      throw new TypeError("fetch failed for http://sonarr.test:8989/api/v3/series/editor");
    });

    const error = await rejectionOf(deleteSeries({ seriesIds: [1], deleteFiles: true, addImportListExclusion: true }));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr series delete request failed: network error");
    expect(error.message).not.toContain("sonarr.test");
  });
});

describe("getSeriesPoster", () => {
  const POSTER_PATH = "/api/v3/mediacover/42/poster-250.jpg";

  function servePoster(reply: () => Response) {
    fetchMock.mockImplementation(async (req: Request) => {
      if (new URL(req.url).pathname === POSTER_PATH) return reply();
      throw new TypeError(`unexpected request to ${new URL(req.url).pathname}`);
    });
  }

  it("requests exactly the fixed poster file with the key in a header and not in the URL", async () => {
    servePoster(() => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 }));

    await getSeriesPoster(42);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("GET");
    expect(req.url).toBe("http://sonarr.test:8989/api/v3/mediacover/42/poster-250.jpg");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
    expect(req.url).not.toContain(FAKE_KEY);
  });

  it("returns the image bytes", async () => {
    servePoster(() => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200 }));

    expect(Array.from(await getSeriesPoster(42))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
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

    expect(Array.from(await getSeriesPoster(42))).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x01]);
  });

  it("throws an invalid ArrRequestError for a body that is not a JPEG, such as an HTML login page", async () => {
    servePoster(() => new Response("<!doctype html><title>Login</title>", { status: 200 }));

    const error = await rejectionOf(getSeriesPoster(42));

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

    const error = await rejectionOf(getSeriesPoster(42));

    expect((error as ArrRequestError).kind).toBe("invalid");
    expect(cancelled).toBe(true);
    // 2 MiB cap with 1 MiB chunks: the third chunk goes over. Allow one extra for stream read-ahead.
    expect(pulls).toBeLessThanOrEqual(4);
  });

  it("throws an invalid ArrRequestError for an empty body", async () => {
    servePoster(() => new Response(new Uint8Array(0), { status: 200 }));

    const error = await rejectionOf(getSeriesPoster(42));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
    expect(error.message).toBe("Sonarr poster response was not a usable image");
  });

  it("throws an invalid ArrRequestError for a body larger than MAX_POSTER_BYTES", async () => {
    // A valid JPEG start, so only the size cap can reject it.
    const body = new Uint8Array(MAX_POSTER_BYTES + 1);
    body.set([0xff, 0xd8, 0xff]);
    servePoster(() => new Response(body, { status: 200 }));

    const error = await rejectionOf(getSeriesPoster(42));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
  });

  it("reports a body that fails mid-read as a network error, without the underlying message", async () => {
    servePoster(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
              controller.error(new TypeError(`socket reset by http://sonarr.test:8989 ${FAKE_KEY}`));
            },
          }),
          { status: 200 },
        ),
    );

    const error = await rejectionOf(getSeriesPoster(42));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("network");
    expect(error.message).not.toContain("sonarr.test");
    expect(error.message).not.toContain(FAKE_KEY);
  });

  it("throws ArrRequestError with HTTP 404 for a missing poster", async () => {
    servePoster(() => new Response(`not found at http://sonarr.test:8989 ${FAKE_KEY}`, { status: 404 }));

    const error = await rejectionOf(getSeriesPoster(42));

    expect(error).toBeInstanceOf(ArrRequestError);
    expect(error.message).toBe("Sonarr poster request failed: HTTP 404");
    expect(error.message).not.toContain("sonarr.test");
    expect(error.message).not.toContain(FAKE_KEY);
  });
});

import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchEpisodeManualImport,
  fetchMovieManualImport,
  SCAN_TIMEOUT_MS,
  startEpisodeManualImport,
  startMovieManualImport,
} from "./manual-import";
import { ArrRequestError } from "./request";

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

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function requestAt(call: number): Request {
  return fetchMock.mock.calls[call][0] as Request;
}

describe("fetchMovieManualImport", () => {
  it("asks Radarr to scan one download, leaving out files already in the library, the key only in a header", async () => {
    fetchMock.mockResolvedValue(json([]));

    await fetchMovieManualImport("DL-1");

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("GET");
    expect(url.host).toBe("radarr.test:7878");
    expect(url.pathname).toBe("/api/v3/manualimport");
    expect(url.searchParams.get("downloadId")).toBe("DL-1");
    expect(url.searchParams.get("filterExistingFiles")).toBe("true");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
  });

  it("allows the longer scan timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(json([]));

    await fetchMovieManualImport("DL-1");

    expect(timeout).toHaveBeenCalledWith(SCAN_TIMEOUT_MS);
    expect(SCAN_TIMEOUT_MS).toBe(60_000);
  });

  it("returns the files Radarr sends", async () => {
    fetchMock.mockResolvedValue(json([{ id: 5, path: "/a.mkv" }]));

    await expect(fetchMovieManualImport("DL-1")).resolves.toEqual([{ id: 5, path: "/a.mkv" }]);
  });

  it("rejects a reply that is not a list", async () => {
    fetchMock.mockResolvedValue(json({ records: [] }));

    const error = await fetchMovieManualImport("DL-1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Radarr manual import response was not a list");
  });

  it("does not leak the key or host on HTTP 500", async () => {
    fetchMock.mockResolvedValue(new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }));

    const error = await fetchMovieManualImport("DL-1").catch((e: unknown) => e);

    expect((error as ArrRequestError).message).toBe("Radarr manual import request failed: HTTP 500");
    expect((error as ArrRequestError).message).not.toContain(FAKE_KEY);
  });
});

describe("fetchEpisodeManualImport", () => {
  it("asks Sonarr to scan one download on Sonarr's route, the key only in a header", async () => {
    fetchMock.mockResolvedValue(json([]));

    await fetchEpisodeManualImport("DL-2");

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("GET");
    expect(url.host).toBe("sonarr.test:8989");
    expect(url.pathname).toBe("/api/v3/manualimport");
    expect(url.searchParams.get("downloadId")).toBe("DL-2");
    expect(url.searchParams.get("filterExistingFiles")).toBe("true");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
  });

  it("reports a network error without the host", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed to sonarr.test:8989"));

    const error = await fetchEpisodeManualImport("DL-2").catch((e: unknown) => e);

    expect((error as ArrRequestError).message).toBe("Sonarr manual import request failed: network error");
    expect((error as ArrRequestError).message).not.toContain("sonarr.test");
  });
});

describe("startMovieManualImport and startEpisodeManualImport", () => {
  async function sentBody(call = 0): Promise<unknown> {
    return JSON.parse(await requestAt(call).text()) as unknown;
  }

  it("POSTs a ManualImport command to Radarr with the files in the body and the key in a header", async () => {
    fetchMock.mockResolvedValue(json({ id: 9 }, 201));
    const files = [
      {
        path: "/x/a.mkv",
        folderName: "f",
        movieId: 1,
        quality: { quality: { id: 7, name: "Bluray-1080p" } },
        languages: [{ id: 1, name: "English" }],
        releaseGroup: null,
        indexerFlags: 0,
        downloadId: "DL-1",
      },
    ];

    await startMovieManualImport(files);

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("POST");
    expect(url.host).toBe("radarr.test:7878");
    expect(url.pathname).toBe("/api/v3/command");
    expect(url.search).toBe("");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody()).toStrictEqual({ name: "ManualImport", importMode: "auto", files });
  });

  it("POSTs a ManualImport command to Sonarr with the episode ids in the body", async () => {
    fetchMock.mockResolvedValue(json({ id: 9 }, 201));
    const files = [
      {
        path: "/x/b.mkv",
        folderName: null,
        seriesId: 10,
        episodeIds: [1002, 1003],
        episodeFileId: null,
        quality: { quality: { id: 3, name: "WEBDL-1080p" } },
        languages: [],
        releaseGroup: null,
        indexerFlags: 0,
        releaseType: "multiEpisode" as const,
        downloadId: null,
      },
    ];

    await startEpisodeManualImport(files);

    const req = requestAt(0);
    expect(req.method).toBe("POST");
    expect(new URL(req.url).host).toBe("sonarr.test:8989");
    expect(new URL(req.url).pathname).toBe("/api/v3/command");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
    expect(await sentBody()).toStrictEqual({ name: "ManualImport", importMode: "auto", files });
  });

  it("names the upstream in the error and does not leak the key on HTTP 400", async () => {
    fetchMock.mockResolvedValue(new Response(`bad ${FAKE_KEY}`, { status: 400 }));

    const error = await startMovieManualImport([]).catch((e: unknown) => e);

    expect((error as ArrRequestError).message).toBe("Radarr manual import command request failed: HTTP 400");
    expect((error as ArrRequestError).status).toBe(400);
    expect((error as ArrRequestError).message).not.toContain(FAKE_KEY);
  });
});

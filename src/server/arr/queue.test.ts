import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchEpisodeQueue, fetchMovieQueue, removeEpisodeQueueItem, removeMovieQueueItem } from "./queue";
import { ArrRequestError, DELETE_TIMEOUT_MS } from "./request";

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
});

function requestAt(call: number): Request {
  return fetchMock.mock.calls[call][0] as Request;
}

describe("fetchMovieQueue", () => {
  it("asks Radarr for the detailed queue with movies included, the key only in a header", async () => {
    fetchMock.mockResolvedValue(json([]));

    await fetchMovieQueue({ includeMovie: true });

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("GET");
    expect(url.host).toBe("radarr.test:7878");
    expect(url.pathname).toBe("/api/v3/queue/details");
    expect(url.searchParams.get("includeMovie")).toBe("true");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
  });

  it("leaves movies out of the reply when asked not to include them", async () => {
    fetchMock.mockResolvedValue(json([]));

    await fetchMovieQueue({ includeMovie: false });

    expect(new URL(requestAt(0).url).searchParams.get("includeMovie")).toBe("false");
  });

  it("returns the items Radarr sends", async () => {
    fetchMock.mockResolvedValue(json([{ id: 1, movieId: 2 }]));

    await expect(fetchMovieQueue({ includeMovie: true })).resolves.toEqual([{ id: 1, movieId: 2 }]);
  });

  it("rejects a reply that is not a list", async () => {
    fetchMock.mockResolvedValue(json({ records: [] }));

    const error = await fetchMovieQueue({ includeMovie: true }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Radarr queue response was not a list");
    expect((error as ArrRequestError).kind).toBe("invalid");
  });

  it("does not leak the key or host on HTTP 500", async () => {
    fetchMock.mockResolvedValue(new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }));

    const error = await fetchMovieQueue({ includeMovie: true }).catch((e: unknown) => e);

    expect((error as ArrRequestError).message).toBe("Radarr queue request failed: HTTP 500");
    expect((error as ArrRequestError).message).not.toContain(FAKE_KEY);
  });
});

describe("fetchEpisodeQueue", () => {
  it("asks Sonarr for the detailed queue with series and episodes included, the key only in a header", async () => {
    fetchMock.mockResolvedValue(json([]));

    await fetchEpisodeQueue({ includeSeries: true, includeEpisode: true });

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("GET");
    expect(url.host).toBe("sonarr.test:8989");
    expect(url.pathname).toBe("/api/v3/queue/details");
    expect(url.searchParams.get("includeSeries")).toBe("true");
    expect(url.searchParams.get("includeEpisode")).toBe("true");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
  });

  it("limits the request to one series, and leaves the nested objects out when asked", async () => {
    fetchMock.mockResolvedValue(json([]));

    await fetchEpisodeQueue({ includeSeries: false, includeEpisode: false, seriesId: 7 });

    const url = new URL(requestAt(0).url);
    expect(url.searchParams.get("seriesId")).toBe("7");
    expect(url.searchParams.get("includeSeries")).toBe("false");
    expect(url.searchParams.get("includeEpisode")).toBe("false");
  });

  it("reports a network error without the host", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed to sonarr.test:8989"));

    const error = await fetchEpisodeQueue({ includeSeries: true, includeEpisode: true }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Sonarr queue request failed: network error");
    expect((error as ArrRequestError).message).not.toContain("sonarr.test");
  });
});

describe("removeMovieQueueItem and removeEpisodeQueueItem", () => {
  const OPTIONS = { removeFromClient: true, blocklist: true, skipRedownload: false };

  async function sentBody(call = 0): Promise<unknown> {
    return JSON.parse(await requestAt(call).text()) as unknown;
  }

  it("sends a DELETE to Radarr's bulk queue route with the key in a header, the ids in the body and the query flags", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await removeMovieQueueItem(4, { removeFromClient: true, blocklist: false, skipRedownload: false });

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("DELETE");
    expect(url.host).toBe("radarr.test:7878");
    expect(url.pathname).toBe("/api/v3/queue/bulk");
    expect(url.searchParams.get("removeFromClient")).toBe("true");
    expect(url.searchParams.get("blocklist")).toBe("false");
    expect(url.searchParams.get("skipRedownload")).toBe("false");
    expect(url.searchParams.get("changeCategory")).toBe("false");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
    expect(await sentBody()).toStrictEqual({ ids: [4] });
  });

  it("sends a DELETE to Sonarr's bulk queue route with the same query and body shape", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await removeEpisodeQueueItem(12, OPTIONS);

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("DELETE");
    expect(url.host).toBe("sonarr.test:8989");
    expect(url.pathname).toBe("/api/v3/queue/bulk");
    expect(url.searchParams.get("removeFromClient")).toBe("true");
    expect(url.searchParams.get("blocklist")).toBe("true");
    expect(url.searchParams.get("skipRedownload")).toBe("false");
    expect(url.searchParams.get("changeCategory")).toBe("false");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(await sentBody()).toStrictEqual({ ids: [12] });
  });

  it("sends skipRedownload true only when the release is also blocklisted", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await removeEpisodeQueueItem(1, { removeFromClient: false, blocklist: true, skipRedownload: true });
    await removeEpisodeQueueItem(1, { removeFromClient: false, blocklist: false, skipRedownload: true });

    expect(new URL(requestAt(0).url).searchParams.get("skipRedownload")).toBe("true");
    expect(new URL(requestAt(1).url).searchParams.get("skipRedownload")).toBe("false");
    expect(new URL(requestAt(1).url).searchParams.get("blocklist")).toBe("false");
  });

  it("allows the longer delete timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await removeMovieQueueItem(1, OPTIONS);

    expect(timeout).toHaveBeenCalledWith(DELETE_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it("names the upstream in the error and does not leak the key or host on HTTP 500", async () => {
    fetchMock.mockResolvedValue(new Response(`boom ${FAKE_KEY} at http://sonarr.test:8989`, { status: 500 }));

    const error = await removeEpisodeQueueItem(1, OPTIONS).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Sonarr queue remove request failed: HTTP 500");
    expect((error as ArrRequestError).message).not.toContain(FAKE_KEY);
    expect((error as ArrRequestError).message).not.toContain("sonarr.test");
  });

  it("reports a Radarr network error without the host", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed to radarr.test:7878"));

    const error = await removeMovieQueueItem(1, OPTIONS).catch((e: unknown) => e);

    expect((error as ArrRequestError).message).toBe("Radarr queue remove request failed: network error");
    expect((error as ArrRequestError).message).not.toContain("radarr.test");
  });
});

import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchEpisodeHistory, fetchMovieHistory, markEpisodeHistoryFailed, markMovieHistoryFailed } from "./history";
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
});

function requestAt(call: number): Request {
  return fetchMock.mock.calls[call][0] as Request;
}

describe("fetchMovieHistory", () => {
  it("asks Radarr for the newest page with movies included, the key only in a header", async () => {
    fetchMock.mockResolvedValue(json({ totalRecords: 0, records: [] }));

    await fetchMovieHistory(100, []);

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("GET");
    expect(url.host).toBe("radarr.test:7878");
    expect(url.pathname).toBe("/api/v3/history");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("pageSize")).toBe("100");
    expect(url.searchParams.get("sortKey")).toBe("date");
    expect(url.searchParams.get("sortDirection")).toBe("descending");
    expect(url.searchParams.get("includeMovie")).toBe("true");
    expect(url.searchParams.has("eventType")).toBe(false);
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
  });

  it("sends each event code as a repeated eventType parameter", async () => {
    fetchMock.mockResolvedValue(json({ totalRecords: 0, records: [] }));

    await fetchMovieHistory(200, [3, 7]);

    const url = new URL(requestAt(0).url);
    expect(url.searchParams.getAll("eventType")).toEqual(["3", "7"]);
    expect(url.searchParams.get("pageSize")).toBe("200");
  });

  it("returns the total and the records Radarr sends", async () => {
    fetchMock.mockResolvedValue(json({ totalRecords: 42, records: [{ id: 1 }] }));

    await expect(fetchMovieHistory(100, [])).resolves.toEqual({ totalRecords: 42, records: [{ id: 1 }] });
  });

  it("rejects a reply without a record list", async () => {
    fetchMock.mockResolvedValue(json([{ id: 1 }]));

    const error = await fetchMovieHistory(100, []).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Radarr history response was not a history page");
    expect((error as ArrRequestError).kind).toBe("invalid");
  });

  it("does not leak the key, host or body on HTTP 500", async () => {
    fetchMock.mockResolvedValue(new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }));

    const error = await fetchMovieHistory(100, []).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Radarr history request failed: HTTP 500");
    expect((error as ArrRequestError).message).not.toContain(FAKE_KEY);
  });
});

describe("fetchEpisodeHistory", () => {
  it("asks Sonarr for the newest page with series and episodes included, the key only in a header", async () => {
    fetchMock.mockResolvedValue(json({ totalRecords: 0, records: [] }));

    await fetchEpisodeHistory(300, [4]);

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("GET");
    expect(url.host).toBe("sonarr.test:8989");
    expect(url.pathname).toBe("/api/v3/history");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("pageSize")).toBe("300");
    expect(url.searchParams.get("sortKey")).toBe("date");
    expect(url.searchParams.get("sortDirection")).toBe("descending");
    expect(url.searchParams.get("includeSeries")).toBe("true");
    expect(url.searchParams.get("includeEpisode")).toBe("true");
    expect(url.searchParams.getAll("eventType")).toEqual(["4"]);
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
  });

  it("rejects a reply whose count is missing", async () => {
    fetchMock.mockResolvedValue(json({ records: [] }));

    const error = await fetchEpisodeHistory(100, []).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Sonarr history response was not a history page");
  });

  it("reports a network error without the host", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed for http://sonarr.test:8989"));

    const error = await fetchEpisodeHistory(100, []).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Sonarr history request failed: network error");
    expect((error as ArrRequestError).message).not.toContain("sonarr.test");
  });
});

describe("markMovieHistoryFailed", () => {
  it("POSTs to the Radarr failed path with the id, and the key only in a header", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    await markMovieHistoryFailed(55);

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("POST");
    expect(url.host).toBe("radarr.test:7878");
    expect(url.pathname).toBe("/api/v3/history/failed/55");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
  });

  it("reports a non-OK reply as an HTTP error without the body", async () => {
    fetchMock.mockResolvedValue(new Response(`nope ${FAKE_KEY}`, { status: 404 }));

    const error = await markMovieHistoryFailed(55).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Radarr mark failed request failed: HTTP 404");
    expect((error as ArrRequestError).status).toBe(404);
  });
});

describe("markEpisodeHistoryFailed", () => {
  it("POSTs to the Sonarr failed path with the id, and the key only in a header", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    await markEpisodeHistoryFailed(77);

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("POST");
    expect(url.host).toBe("sonarr.test:8989");
    expect(url.pathname).toBe("/api/v3/history/failed/77");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
  });

  it("reports a timeout with the timeout kind", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));

    const error = await markEpisodeHistoryFailed(77).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("timeout");
    expect((error as ArrRequestError).message).toBe("Sonarr mark failed request failed: timed out");
  });
});

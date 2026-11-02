import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchEpisodeCalendar, fetchMovieCalendar } from "./calendar";
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

describe("fetchMovieCalendar", () => {
  it("asks Radarr for the calendar over the whole days, with unmonitored on, and the key only in a header", async () => {
    fetchMock.mockResolvedValue(json([]));

    await fetchMovieCalendar("2026-11-02", "2026-12-06");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("GET");
    expect(url.host).toBe("radarr.test:7878");
    expect(url.pathname).toBe("/api/v3/calendar");
    expect([...url.searchParams.keys()].sort()).toEqual(["end", "start", "unmonitored"]);
    expect(url.searchParams.get("start")).toBe("2026-11-02T00:00:00Z");
    expect(url.searchParams.get("end")).toBe("2026-12-06T23:59:59Z");
    expect(url.searchParams.get("unmonitored")).toBe("true");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
  });

  it("returns the list Radarr sends", async () => {
    fetchMock.mockResolvedValue(json([{ id: 1, title: "A" }]));

    await expect(fetchMovieCalendar("2026-11-02", "2026-12-06")).resolves.toEqual([{ id: 1, title: "A" }]);
  });

  it("rejects a reply that is not a list", async () => {
    fetchMock.mockResolvedValue(json({ message: "nope" }));

    const error = await fetchMovieCalendar("2026-11-02", "2026-12-06").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Radarr calendar response was not a list");
  });

  it("does not leak the key, host or body on HTTP 500", async () => {
    fetchMock.mockResolvedValue(new Response(`boom ${FAKE_KEY} at http://radarr.test:7878`, { status: 500 }));

    const error = await fetchMovieCalendar("2026-11-02", "2026-12-06").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Radarr calendar request failed: HTTP 500");
    expect((error as ArrRequestError).message).not.toContain(FAKE_KEY);
  });
});

describe("fetchEpisodeCalendar", () => {
  it("widens the window by a day each side, includes series, and sends no file, image or tag options", async () => {
    fetchMock.mockResolvedValue(json([]));

    await fetchEpisodeCalendar("2026-11-02", "2026-12-06");

    const req = requestAt(0);
    const url = new URL(req.url);
    expect(req.method).toBe("GET");
    expect(url.host).toBe("sonarr.test:8989");
    expect(url.pathname).toBe("/api/v3/calendar");
    expect([...url.searchParams.keys()].sort()).toEqual(["end", "includeSeries", "start", "unmonitored"]);
    expect(url.searchParams.get("start")).toBe("2026-11-01T00:00:00Z");
    expect(url.searchParams.get("end")).toBe("2026-12-07T23:59:59Z");
    expect(url.searchParams.get("unmonitored")).toBe("true");
    expect(url.searchParams.get("includeSeries")).toBe("true");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
  });

  it("rejects a reply that is not a list", async () => {
    fetchMock.mockResolvedValue(json("nope"));

    const error = await fetchEpisodeCalendar("2026-11-02", "2026-12-06").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Sonarr calendar response was not a list");
  });

  it("reports a network error without the host", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed for http://sonarr.test:8989"));

    const error = await fetchEpisodeCalendar("2026-11-02", "2026-12-06").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Sonarr calendar request failed: network error");
    expect((error as ArrRequestError).message).not.toContain("sonarr.test");
  });
});

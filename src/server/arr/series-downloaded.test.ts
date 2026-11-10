import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeriesRow } from "./series";

const { FAKE_KEY, fakeConnection, connectionMock } = vi.hoisted(() => {
  const key = "fake-api-key-0123456789abcdefghi"; // 32 chars, not a real secret
  return {
    FAKE_KEY: key,
    fakeConnection: { url: "http://sonarr.test:8989", apiKey: key },
    connectionMock: { unset: false },
  };
});

vi.mock("@/server/settings/connections", () => ({
  getConnection: () => (connectionMock.unset ? null : fakeConnection),
}));

import { resetSeriesDownloadedCache, seriesDownloadedAt } from "./series-downloaded";

/** Only the fields the download-date lookup reads. */
function row(id: number, episodeFileCount = 1, sizeOnDisk = 1000): SeriesRow {
  return { id, episodeFileCount, sizeOnDisk } as SeriesRow;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

/** Answers the episode-file call per series. A reply may be a function that throws, to simulate a failure. */
function serveFiles(files: Record<number, () => Response | unknown[]>) {
  fetchMock.mockImplementation(async (req: Request) => {
    const url = new URL(req.url);
    if (url.pathname !== "/api/v3/episodefile") throw new TypeError(`unexpected request to ${url.pathname}`);
    const seriesId = Number(url.searchParams.get("seriesId"));
    const reply = files[seriesId];
    if (!reply) throw new TypeError(`no reply set for series ${seriesId}`);
    const body = reply();
    return body instanceof Response ? body : json(body);
  });
}

/** How many episode-file requests the mock has seen. */
const episodeFileCalls = () => fetchMock.mock.calls.filter(([req]) => new URL((req as Request).url).pathname === "/api/v3/episodefile").length;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetSeriesDownloadedCache();
  connectionMock.unset = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("seriesDownloadedAt", () => {
  it("gives each series the newest dateAdded, comparing the dates as times", async () => {
    serveFiles({
      1: () => [
        { dateAdded: "2025-03-01T01:00:00+02:00" },
        { dateAdded: "2025-02-28T23:30:00Z" },
        { dateAdded: "2024-06-01T00:00:00Z" },
      ],
    });
    const { dates } = await seriesDownloadedAt([row(1)]);
    // 2025-03-01T01:00+02:00 is 2025-02-28T23:00Z, which is earlier than 2025-02-28T23:30Z.
    expect(dates.get(1)).toBe("2025-02-28T23:30:00Z");
  });

  it("ignores a file whose dateAdded doesn't parse", async () => {
    serveFiles({ 1: () => [{ dateAdded: "not a date" }, { dateAdded: "2024-06-01T00:00:00Z" }] });
    expect((await seriesDownloadedAt([row(1)])).dates.get(1)).toBe("2024-06-01T00:00:00Z");
  });

  it("gives null, and makes no request, for a series with no episode files", async () => {
    serveFiles({});
    const { dates } = await seriesDownloadedAt([row(2, 0)]);
    expect(dates.get(2)).toBeNull();
    expect(episodeFileCalls()).toBe(0);
  });

  it("makes no second request while the file count and size are unchanged", async () => {
    serveFiles({ 1: () => [{ dateAdded: "2024-06-01T00:00:00Z" }] });
    await seriesDownloadedAt([row(1)]);
    const { dates: again } = await seriesDownloadedAt([row(1)]);
    expect(again.get(1)).toBe("2024-06-01T00:00:00Z");
    expect(episodeFileCalls()).toBe(1);
  });

  it("asks again when the file count or the size on disk changes", async () => {
    serveFiles({ 1: () => [{ dateAdded: "2024-06-01T00:00:00Z" }] });
    await seriesDownloadedAt([row(1, 1, 1000)]);
    await seriesDownloadedAt([row(1, 2, 1000)]);
    await seriesDownloadedAt([row(1, 2, 5000)]);
    expect(episodeFileCalls()).toBe(3);
  });

  it("gives null for a series whose request fails, keeps the others, and logs one fixed line without details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    serveFiles({
      1: () => new Response("upstream body", { status: 500 }),
      2: () => [{ dateAdded: "2024-06-01T00:00:00Z" }],
    });
    const { dates, failed } = await seriesDownloadedAt([row(1), row(2)]);
    expect(dates.get(1)).toBeNull();
    expect(dates.get(2)).toBe("2024-06-01T00:00:00Z");
    expect(failed).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("Home page: some series download dates could not be loaded");
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain(FAKE_KEY);
    expect(logged).not.toContain("apikey");
    expect(logged).not.toContain("sonarr.test");
    expect(logged).not.toContain("/api/v3");
  });

  it("does not cache a failed series, so the next call asks Sonarr again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    serveFiles({ 1: () => new Response("", { status: 500 }) });
    await seriesDownloadedAt([row(1)]);
    await seriesDownloadedAt([row(1)]);
    expect(episodeFileCalls()).toBe(2);
  });

  it("sends seriesId as a query parameter and the key only in the X-Api-Key header", async () => {
    serveFiles({ 7: () => [] });
    await seriesDownloadedAt([row(7)]);
    const [req] = fetchMock.mock.calls[0] as [Request];
    expect(new URL(req.url).searchParams.get("seriesId")).toBe("7");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
    expect(req.url).not.toContain(FAKE_KEY);
  });

  it("gives null for every series, and makes no request, when Sonarr isn't set up", async () => {
    connectionMock.unset = true;
    serveFiles({});
    const { dates } = await seriesDownloadedAt([row(1), row(2)]);
    expect(dates.get(1)).toBeNull();
    expect(dates.get(2)).toBeNull();
    expect(episodeFileCalls()).toBe(0);
  });

  it("has at most four requests in flight at once", async () => {
    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return json([{ dateAdded: "2024-06-01T00:00:00Z" }]);
    });
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 1));
    const { dates } = await seriesDownloadedAt(rows);
    expect(episodeFileCalls()).toBe(10);
    expect(peak).toBe(4);
    expect(dates.size).toBe(10);
  });

  it("stops asking once Sonarr can't be reached, giving the rest null without a request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 1));
    const { dates, failed } = await seriesDownloadedAt(rows);
    // The first four were already in flight when the first failure came back; the other six were never sent.
    expect(episodeFileCalls()).toBe(4);
    expect([...dates.values()]).toEqual(Array(10).fill(null));
    expect(failed).toBe(true);
  });

  it("keeps asking after an HTTP error, which is about one series rather than Sonarr being down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    serveFiles(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [i + 1, () => new Response("", { status: 404 })])));
    await seriesDownloadedAt(Array.from({ length: 6 }, (_, i) => row(i + 1)));
    expect(episodeFileCalls()).toBe(6);
  });
});

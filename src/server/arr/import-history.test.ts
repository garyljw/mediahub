import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FAKE_KEY, fakeConnections } = vi.hoisted(() => {
  const key = "fake-api-key-0123456789abcdefghi"; // 32 chars, not a real secret
  return {
    FAKE_KEY: key,
    fakeConnections: {
      radarr: { url: "http://radarr.test:7878", apiKey: key },
      sonarr: { url: "http://sonarr.test:8989", apiKey: key },
    },
  };
});

vi.mock("@/server/settings/connections", () => ({
  getConnection: (app: "radarr" | "sonarr") => fakeConnections[app],
}));

import { movieImportDates, resetImportHistoryCache, seriesImportDates } from "./import-history";

type ImportRecord = { id: number; date: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

/** Serves the history from a newest-first list of records, paged the way Radarr and Sonarr page it. */
function serveHistory(records: ImportRecord[], idField: "movieId" | "seriesId") {
  fetchMock.mockImplementation(async (req: Request) => {
    const url = new URL(req.url);
    if (url.pathname !== "/api/v3/history") throw new TypeError(`unexpected request to ${url.pathname}`);
    const page = Number(url.searchParams.get("page"));
    const pageSize = Number(url.searchParams.get("pageSize"));
    const slice = records.slice((page - 1) * pageSize, page * pageSize);
    return json({
      page,
      pageSize,
      totalRecords: records.length,
      records: slice.map((record) => ({ [idField]: record.id, date: record.date, eventType: "downloadFolderImported" })),
    });
  });
}

/** The history calls the mock has seen, as URLs. */
const historyUrls = () => fetchMock.mock.calls.map(([req]) => (req as Request).url);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetImportHistoryCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("movieImportDates", () => {
  it("asks for imports only, newest first, with the key only in the header", async () => {
    serveHistory([{ id: 1, date: "2026-01-05T00:00:00Z" }], "movieId");
    await movieImportDates();
    const [req] = fetchMock.mock.calls[0] as [Request];
    const params = new URL(req.url).searchParams;
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("1000");
    expect(params.get("sortKey")).toBe("date");
    expect(params.get("sortDirection")).toBe("descending");
    expect(params.getAll("eventType")).toEqual(["3"]);
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
    expect(req.url).not.toContain(FAKE_KEY);
  });

  it("walks every page until the total is reached", async () => {
    // 2,500 imports in newest-first order: three pages of 1,000.
    const records = Array.from({ length: 2500 }, (_, i) => ({
      id: i + 1,
      date: new Date(Date.UTC(2026, 0, 1) - i * 60_000).toISOString(),
    }));
    serveHistory(records, "movieId");
    const dates = await movieImportDates();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(dates).toBeInstanceOf(Map);
    // The last record is on the third page, so it is only known if every page was read.
    expect((dates as Map<number, string>).get(2500)).toBe(records[2499].date);
  });

  it("keeps the newest import date for each movie", async () => {
    serveHistory(
      [
        { id: 1, date: "2026-01-05T00:00:00Z" },
        { id: 2, date: "2025-06-01T00:00:00Z" },
        { id: 1, date: "2025-01-01T00:00:00Z" },
      ],
      "movieId",
    );
    const dates = (await movieImportDates()) as Map<number, string>;
    expect(dates.get(1)).toBe("2026-01-05T00:00:00Z");
    expect(dates.get(2)).toBe("2025-06-01T00:00:00Z");
  });

  it("on a later call reads only the newest page, stopping at the first import older than the last newest, and merges the new dates", async () => {
    serveHistory(
      [
        { id: 1, date: "2026-01-05T00:00:00Z" },
        { id: 2, date: "2025-06-01T00:00:00Z" },
      ],
      "movieId",
    );
    await movieImportDates();
    fetchMock.mockClear();

    // Movie 1 was imported again, and a long older tail follows the new record. Stopping early means only page 1 is read.
    const newer = [{ id: 1, date: "2026-03-01T00:00:00Z" }, ...Array.from({ length: 300 }, (_, i) => ({ id: 100 + i, date: "2024-01-01T00:00:00Z" }))];
    serveHistory(newer, "movieId");
    const dates = (await movieImportDates()) as Map<number, string>;

    expect(historyUrls()).toHaveLength(1);
    expect(new URL(historyUrls()[0]).searchParams.get("pageSize")).toBe("250");
    expect(dates.get(1)).toBe("2026-03-01T00:00:00Z");
    expect(dates.get(2)).toBe("2025-06-01T00:00:00Z");
  });

  it("keeps the cached dates when a later call fails, and logs one fixed line without details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    serveHistory([{ id: 1, date: "2026-01-05T00:00:00Z" }], "movieId");
    await movieImportDates();

    fetchMock.mockImplementation(async () => new Response("upstream body", { status: 500 }));
    const dates = (await movieImportDates()) as Map<number, string>;

    expect(dates.get(1)).toBe("2026-01-05T00:00:00Z");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("Home page: Radarr import history could not be loaded");
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain(FAKE_KEY);
    expect(logged).not.toContain("apikey");
    expect(logged).not.toContain("radarr.test");
    expect(logged).not.toContain("/api/v3");
  });

  it("gives failed when a call fails and nothing is cached", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(async () => new Response("upstream body", { status: 500 }));
    expect(await movieImportDates()).toBe("failed");
    expect(errorSpy).toHaveBeenCalledWith("Home page: Radarr import history could not be loaded");
  });
});

describe("seriesImportDates", () => {
  it("reads seriesId from the Sonarr records and asks Sonarr's history", async () => {
    serveHistory([{ id: 7, date: "2026-02-02T00:00:00Z" }], "seriesId");
    const dates = (await seriesImportDates()) as Map<number, string>;
    expect(dates.get(7)).toBe("2026-02-02T00:00:00Z");
    const [req] = fetchMock.mock.calls[0] as [Request];
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(new URL(req.url).searchParams.getAll("eventType")).toEqual(["3"]);
  });
});

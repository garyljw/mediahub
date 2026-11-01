import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as RadarrComponents } from "./generated/radarr";
import type { components as SonarrComponents } from "./generated/sonarr";
import queueFixture from "./__fixtures__/radarr-queue-details.json";
import sonarrQueueFixture from "./__fixtures__/sonarr-queue-details.json";
import { ArrRequestError } from "./request";
import {
  MAX_ACTIVITY_MESSAGES,
  MAX_ACTIVITY_MESSAGE_CHARS,
  listEpisodeActivity,
  listMovieActivity,
  listSeriesActivity,
  toActivity,
} from "./activity";

type QueueResource = RadarrComponents["schemas"]["QueueResource"];
type SonarrQueueResource = SonarrComponents["schemas"]["QueueResource"];

const queue = queueFixture as QueueResource[];
const sonarrQueue = sonarrQueueFixture as SonarrQueueResource[];

const NOW = Date.parse("2026-10-18T12:00:00Z");

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

const ALLOWED_KEYS = ["count", "etaSeconds", "id", "messages", "progress", "severity", "state"].sort();

const byMovieId = (item: QueueResource) => item.movieId;
const bySeriesId = (item: SonarrQueueResource) => item.seriesId;
const byEpisodeId = (item: SonarrQueueResource) => item.episodeId;

/** A queue item with working defaults; overrides change one rule at a time. */
function item(overrides: Partial<QueueResource> = {}): QueueResource {
  return {
    id: 1,
    movieId: 1,
    status: "downloading",
    trackedDownloadStatus: "ok",
    trackedDownloadState: "downloading",
    size: 1000,
    sizeleft: 500,
    ...overrides,
  };
}

/** A Sonarr queue item with working defaults. */
function sonarrItem(overrides: Partial<SonarrQueueResource> = {}): SonarrQueueResource {
  return {
    id: 1,
    seriesId: 1,
    episodeId: 1,
    status: "downloading",
    trackedDownloadStatus: "ok",
    trackedDownloadState: "downloading",
    size: 1000,
    sizeleft: 500,
    ...overrides,
  };
}

/** The activity for one item, with messages included. */
function one(overrides: Partial<QueueResource>, includeMessages = true) {
  const [entry] = toActivity([item(overrides)], byMovieId, NOW, { includeMessages });
  return entry;
}

describe("toActivity state", () => {
  it.each([
    ["downloadClientUnavailable", "importing", "clientUnavailable"],
    ["downloading", "importBlocked", "importBlocked"],
    ["downloading", "importPending", "importPending"],
    ["downloading", "importing", "importing"],
    ["downloading", "imported", "importing"],
    ["downloading", "failedPending", "failed"],
    ["downloading", "failed", "failed"],
    ["failed", "downloading", "failed"],
    ["paused", "downloading", "paused"],
    ["queued", "downloading", "queued"],
    ["delay", "downloading", "delayed"],
    ["completed", "downloading", "importPending"],
    ["downloading", "downloading", "downloading"],
    ["warning", "downloading", "downloading"],
    ["downloading", "ignored", "downloading"],
    ["unknown", "ignored", "unknown"],
  ] as const)("status %s with tracked state %s gives %s", (status, trackedDownloadState, expected) => {
    expect(one({ status, trackedDownloadState }).state).toBe(expected);
  });

  it("gives unknown when the status is missing or unrecognised", () => {
    expect(one({ status: undefined, trackedDownloadState: undefined }).state).toBe("unknown");
    expect(one({ status: "bogus" as QueueResource["status"], trackedDownloadState: undefined }).state).toBe("unknown");
  });
});

describe("toActivity severity", () => {
  it("starts from the tracked download status", () => {
    expect(one({ trackedDownloadStatus: "ok" }).severity).toBe("ok");
    expect(one({ trackedDownloadStatus: "warning" }).severity).toBe("warning");
    expect(one({ trackedDownloadStatus: "error" }).severity).toBe("error");
  });

  it("raises a failed item to error", () => {
    expect(one({ status: "failed", trackedDownloadStatus: "ok" }).severity).toBe("error");
    expect(one({ trackedDownloadState: "failedPending", trackedDownloadStatus: "warning" }).severity).toBe("error");
  });

  it("raises client-unavailable, import-blocked and status-warning items to at least warning", () => {
    expect(one({ status: "downloadClientUnavailable", trackedDownloadStatus: "ok" }).severity).toBe("warning");
    expect(one({ trackedDownloadState: "importBlocked", trackedDownloadStatus: "ok" }).severity).toBe("warning");
    expect(one({ status: "warning", trackedDownloadStatus: "ok" }).severity).toBe("warning");
  });

  it("never lowers the severity the app gave", () => {
    expect(one({ trackedDownloadStatus: "error", status: "queued", trackedDownloadState: "downloading" }).severity).toBe("error");
    expect(one({ trackedDownloadStatus: "warning", status: "paused", trackedDownloadState: "downloading" }).severity).toBe("warning");
  });
});

describe("toActivity progress", () => {
  it("is the whole percent downloaded, rounded down", () => {
    expect(one({ size: 1000, sizeleft: 250 }).progress).toBe(75);
    expect(one({ size: 3, sizeleft: 1 }).progress).toBe(66);
  });

  it("is 0 when nothing is downloaded and 100 when nothing is left", () => {
    expect(one({ size: 1000, sizeleft: 1000 }).progress).toBe(0);
    expect(one({ size: 1000, sizeleft: 0 }).progress).toBe(100);
  });

  it.each([
    ["size is 0", { size: 0, sizeleft: 0 }],
    ["size is missing", { size: undefined, sizeleft: 10 }],
    ["size is negative", { size: -5, sizeleft: 1 }],
    ["size is not finite", { size: Number.POSITIVE_INFINITY, sizeleft: 1 }],
    ["sizeleft is missing", { size: 1000, sizeleft: undefined }],
    ["sizeleft is greater than size", { size: 1000, sizeleft: 2000 }],
    ["sizeleft is negative", { size: 1000, sizeleft: -1 }],
  ])("is null when %s", (_label, sizes) => {
    expect(one(sizes).progress).toBeNull();
  });
});

describe("toActivity eta", () => {
  it("is the rounded seconds until a future completion time", () => {
    expect(one({ estimatedCompletionTime: "2026-10-18T13:00:00Z" }).etaSeconds).toBe(3600);
    expect(one({ estimatedCompletionTime: new Date(NOW + 1400).toISOString() }).etaSeconds).toBe(1);
  });

  it("is null when the completion time is now or in the past", () => {
    expect(one({ estimatedCompletionTime: new Date(NOW).toISOString() }).etaSeconds).toBeNull();
    expect(one({ estimatedCompletionTime: "2026-10-18T11:00:00Z" }).etaSeconds).toBeNull();
  });

  it("is null when the completion time is missing or invalid", () => {
    expect(one({ estimatedCompletionTime: null }).etaSeconds).toBeNull();
    expect(one({ estimatedCompletionTime: undefined }).etaSeconds).toBeNull();
    expect(one({ estimatedCompletionTime: "not a date" }).etaSeconds).toBeNull();
  });
});

describe("toActivity messages", () => {
  const longText = "a".repeat(400);

  it("returns no messages unless includeMessages is set", () => {
    const entry = one({ errorMessage: "Sample error", status: "failed" }, false);
    expect(entry.messages).toEqual([]);
  });

  it("returns the error message first, then each status message line", () => {
    const entry = one({
      errorMessage: "Sample error",
      statusMessages: [{ title: "ignored title", messages: ["first line", "second line"] }],
    });
    expect(entry.messages).toEqual(["Sample error", "first line", "second line"]);
  });

  it("never includes a status message title", () => {
    const entry = one({ statusMessages: [{ title: "Release.Name.2026.1080p", messages: ["the line"] }] });
    expect(entry.messages).toEqual(["the line"]);
  });

  it("trims text, drops empty entries and de-duplicates", () => {
    const entry = one({
      errorMessage: "  same line  ",
      statusMessages: [{ messages: ["same line", "   ", "", "other"] }],
    });
    expect(entry.messages).toEqual(["same line", "other"]);
  });

  it("keeps at most MAX_ACTIVITY_MESSAGES messages", () => {
    const messages = Array.from({ length: MAX_ACTIVITY_MESSAGES + 2 }, (_, i) => `line ${i}`);
    const entry = one({ statusMessages: [{ messages }] });
    expect(entry.messages).toEqual(messages.slice(0, MAX_ACTIVITY_MESSAGES));
  });

  it("cuts a long message to MAX_ACTIVITY_MESSAGE_CHARS characters, ending in an ellipsis", () => {
    const [text] = one({ errorMessage: longText }).messages;
    expect(Array.from(text)).toHaveLength(MAX_ACTIVITY_MESSAGE_CHARS);
    expect(text.endsWith("…")).toBe(true);
    expect(text).toBe("a".repeat(MAX_ACTIVITY_MESSAGE_CHARS - 1) + "…");
  });

  it("leaves a message of exactly MAX_ACTIVITY_MESSAGE_CHARS characters alone", () => {
    const exact = "b".repeat(MAX_ACTIVITY_MESSAGE_CHARS);
    expect(one({ errorMessage: exact }).messages).toEqual([exact]);
  });

  it("counts characters, not UTF-16 units, when cutting", () => {
    const emoji = "😀".repeat(MAX_ACTIVITY_MESSAGE_CHARS + 5);
    const [text] = one({ errorMessage: emoji }).messages;
    expect(Array.from(text)).toHaveLength(MAX_ACTIVITY_MESSAGE_CHARS);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("toActivity several items for one key", () => {
  it("keeps one entry with the count, and takes the message from the most severe item", () => {
    const [entry] = toActivity(
      [
        item({ id: 1, trackedDownloadStatus: "ok", errorMessage: null }),
        item({ id: 2, trackedDownloadStatus: "error", status: "failed", errorMessage: "Sample failure" }),
        item({ id: 3, trackedDownloadStatus: "warning", errorMessage: "Sample warning" }),
      ],
      byMovieId,
      NOW,
      { includeMessages: true },
    );
    expect(entry.count).toBe(3);
    expect(entry.severity).toBe("error");
    expect(entry.state).toBe("failed");
    expect(entry.messages).toEqual(["Sample failure"]);
  });

  it("keeps the earlier item when two items tie on severity", () => {
    const [entry] = toActivity(
      [item({ id: 1, size: 1000, sizeleft: 100 }), item({ id: 2, size: 1000, sizeleft: 500 })],
      byMovieId,
      NOW,
      { includeMessages: false },
    );
    expect(entry.progress).toBe(90);
    expect(entry.count).toBe(2);
  });

  it("lets a warning item beat an ok item even when the ok item comes first", () => {
    const [entry] = toActivity(
      [item({ id: 1, trackedDownloadStatus: "ok" }), item({ id: 2, status: "warning", trackedDownloadStatus: "ok" })],
      byMovieId,
      NOW,
      { includeMessages: false },
    );
    expect(entry.severity).toBe("warning");
  });

  it("returns entries in order of first appearance", () => {
    const result = toActivity(
      [item({ id: 1, movieId: 5 }), item({ id: 2, movieId: 2 }), item({ id: 3, movieId: 5 }), item({ id: 4, movieId: 3 })],
      byMovieId,
      NOW,
      { includeMessages: false },
    );
    expect(result.map((entry) => entry.id)).toEqual([5, 2, 3]);
    expect(result.map((entry) => entry.count)).toEqual([2, 1, 1]);
  });
});

describe("toActivity download count", () => {
  it("counts one download once, however many items it has", () => {
    const [entry] = toActivity(
      [1, 2, 3].map((n) => sonarrItem({ id: n, seriesId: 7, episodeId: n, downloadId: "PACK-A" })),
      bySeriesId,
      NOW,
      { includeMessages: false },
    );
    expect(entry).toMatchObject({ id: 7, count: 1 });
  });

  it("counts two different downloads for one series as 2", () => {
    const [entry] = toActivity(
      [
        sonarrItem({ id: 1, seriesId: 7, episodeId: 1, downloadId: "PACK-A" }),
        sonarrItem({ id: 2, seriesId: 7, episodeId: 2, downloadId: "PACK-A" }),
        sonarrItem({ id: 3, seriesId: 7, episodeId: 3, downloadId: "SINGLE-B" }),
      ],
      bySeriesId,
      NOW,
      { includeMessages: false },
    );
    expect(entry).toMatchObject({ id: 7, count: 2 });
  });

  it("falls back to the title when the downloadId is missing or empty", () => {
    const [entry] = toActivity(
      [
        sonarrItem({ id: 1, seriesId: 7, downloadId: null, title: "Same title" }),
        sonarrItem({ id: 2, seriesId: 7, downloadId: "", title: "Same title" }),
      ],
      bySeriesId,
      NOW,
      { includeMessages: false },
    );
    expect(entry.count).toBe(1);
  });

  it("falls back to the item id when there is no downloadId or title", () => {
    const [entry] = toActivity(
      [
        sonarrItem({ id: 1, seriesId: 7, downloadId: null, title: null }),
        sonarrItem({ id: 2, seriesId: 7, downloadId: null, title: "" }),
      ],
      bySeriesId,
      NOW,
      { includeMessages: false },
    );
    expect(entry.count).toBe(2);
  });

  it("counts an item with no identifying field as its own download", () => {
    const [entry] = toActivity(
      [
        sonarrItem({ id: undefined, seriesId: 7, downloadId: null, title: null }),
        sonarrItem({ id: undefined, seriesId: 7, downloadId: null, title: null }),
      ],
      bySeriesId,
      NOW,
      { includeMessages: false },
    );
    expect(entry.count).toBe(2);
  });
});

describe("toActivity keys", () => {
  it.each([null, undefined, 0, -1, 1.5, Number.NaN])("skips an item whose key is %j", (key) => {
    expect(toActivity([item({ movieId: key as number | null })], byMovieId, NOW, { includeMessages: false })).toEqual([]);
  });
});

describe("toActivity on the Radarr fixture", () => {
  const result = toActivity(queue, byMovieId, NOW, { includeMessages: false });
  const withMessages = toActivity(queue, byMovieId, NOW, { includeMessages: true });

  it("reduces the fixture to one entry per valid movie, in order", () => {
    expect(result.map((entry) => entry.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("maps the downloading item", () => {
    expect(result[0]).toEqual({
      id: 1,
      state: "downloading",
      severity: "ok",
      progress: 75,
      etaSeconds: 3600,
      messages: [],
      count: 1,
    });
  });

  it("maps the paused item with no estimate", () => {
    expect(result[1]).toMatchObject({ state: "paused", progress: 75, etaSeconds: null });
  });

  it("maps the queued item with zero sizes to no progress", () => {
    expect(result[2]).toMatchObject({ state: "queued", progress: null, etaSeconds: null });
  });

  it("maps the import-blocked item to a warning, with its messages when admins ask", () => {
    expect(result[3]).toMatchObject({ state: "importBlocked", severity: "warning", messages: [] });
    expect(withMessages[3].messages).toEqual([
      "Manual import required: no matching movie was found for this download.",
      "Sample second line for the same import problem.",
    ]);
  });

  it("maps the failed item to an error, with its error message when admins ask", () => {
    expect(result[4]).toMatchObject({ state: "failed", severity: "error", progress: 0 });
    expect(withMessages[4].messages).toEqual(["Sample download failure: the client reported the item as failed."]);
  });

  it("uses the warning item for a movie with two items, and counts both", () => {
    expect(result[5]).toMatchObject({ id: 6, state: "downloading", severity: "warning", count: 2 });
    expect(withMessages[5].messages).toEqual(["Sample indexer warning for the second release of movie six."]);
  });

  it("gives no progress or eta when sizeleft is larger than size", () => {
    expect(result[6]).toMatchObject({ id: 7, progress: null, etaSeconds: 5400 });
  });

  it("only ever returns the QueueActivity fields", () => {
    for (const entry of withMessages) {
      expect(Object.keys(entry).sort()).toEqual(ALLOWED_KEYS);
    }
  });

  it("never carries paths, download ids, client or indexer names, release titles or status titles", () => {
    const serialized = JSON.stringify(withMessages);
    expect(serialized).not.toContain("LEAK");
    expect(serialized).not.toContain("secret-path");
    expect(serialized).not.toContain("volume1");
    expect(serialized).not.toContain("outputPath");
    expect(serialized).not.toContain("downloadId");
  });
});

describe("toActivity on the Sonarr fixture", () => {
  const seriesOnly = toActivity(sonarrQueue, bySeriesId, NOW, { includeMessages: true });

  it("gives the season pack one series entry with count 1, not one per episode", () => {
    const pack = seriesOnly.find((entry) => entry.id === 10);
    expect(pack).toEqual({
      id: 10,
      state: "downloading",
      severity: "ok",
      progress: 66,
      etaSeconds: 3600,
      messages: [],
      count: 1,
    });
  });

  it("gives the season pack three episode entries with count 1 each", () => {
    const episodes = toActivity(
      sonarrQueue.filter((entry) => entry.seriesId === 10),
      byEpisodeId,
      NOW,
      { includeMessages: false },
    );
    expect(episodes.map((entry) => [entry.id, entry.count, entry.progress])).toEqual([
      [101, 1, 66],
      [102, 1, 66],
      [103, 1, 66],
    ]);
  });

  it("skips the item with a null seriesId from the series list", () => {
    expect(seriesOnly.map((entry) => entry.id)).toEqual([10, 20, 30]);
  });

  it("gives the import-blocked series a warning, with its messages when admins ask", () => {
    const blocked = seriesOnly.find((entry) => entry.id === 20);
    expect(blocked).toMatchObject({ state: "importBlocked", severity: "warning", progress: 100 });
    expect(blocked?.messages).toEqual([
      "Sample import error text for episode 201.",
      "Manual import required: no matching episode was found for this download.",
      "Sample second line for the same import problem.",
    ]);
  });

  it("gives the pending item with no downloadId its own entry", () => {
    expect(seriesOnly.find((entry) => entry.id === 30)).toMatchObject({ state: "delayed", count: 1 });
  });

  it("never carries paths, download ids, client or indexer names, or release titles", () => {
    const serialized = JSON.stringify(seriesOnly);
    for (const entry of sonarrQueue) {
      for (const secret of [entry.downloadId, entry.outputPath, entry.indexer, entry.downloadClient, entry.title]) {
        if (typeof secret === "string" && secret !== "") expect(serialized).not.toContain(secret);
      }
    }
  });
});

describe("listMovieActivity", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function reply(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  function requestAt(call: number): Request {
    return fetchMock.mock.calls[call][0] as Request;
  }

  it("calls the queue details endpoint with includeMovie=false and the key in a header only", async () => {
    fetchMock.mockImplementation(async () => reply(queue));

    await listMovieActivity({ includeMessages: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("GET");
    const url = new URL(req.url);
    expect(url.host).toBe("radarr.test:7878");
    expect(url.pathname).toBe("/api/v3/queue/details");
    expect(url.search).toBe("?includeMovie=false");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(req.url).not.toContain("apikey");
    expect(req.url).not.toContain(FAKE_KEY);
  });

  it("returns messages only when includeMessages is set", async () => {
    fetchMock.mockImplementation(async () => reply(queue));

    const withoutMessages = await listMovieActivity({ includeMessages: false });
    expect(withoutMessages.every((entry) => entry.messages.length === 0)).toBe(true);

    const withMessages = await listMovieActivity({ includeMessages: true });
    expect(withMessages.find((entry) => entry.id === 4)?.messages.length).toBeGreaterThan(0);
  });

  it("throws an invalid ArrRequestError when the reply is not a list", async () => {
    fetchMock.mockImplementation(async () => reply({ records: [] }));

    const error = await listMovieActivity({ includeMessages: false }).then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
  });
});

describe("Sonarr queue listings", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => reply(sonarrQueue));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function reply(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  function requestAt(call: number): URL & { headers: Headers } {
    const req = fetchMock.mock.calls[call][0] as Request;
    return Object.assign(new URL(req.url), { headers: req.headers });
  }

  it("lists the whole queue for the series table with the key in a header only", async () => {
    await listSeriesActivity({ includeMessages: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = requestAt(0);
    expect(url.host).toBe("sonarr.test:8989");
    expect(url.pathname).toBe("/api/v3/queue/details");
    expect([...url.searchParams.entries()]).toEqual([
      ["includeSeries", "false"],
      ["includeEpisode", "false"],
    ]);
    expect(url.headers.get("X-Api-Key")).toBe(FAKE_KEY);
    expect(url.toString()).not.toContain("apikey");
    expect(url.toString()).not.toContain(FAKE_KEY);
  });

  it("asks for one series' queue, with the same flags, for the episode list", async () => {
    await listEpisodeActivity(10, { includeMessages: false });

    const url = requestAt(0);
    expect(url.pathname).toBe("/api/v3/queue/details");
    expect(url.searchParams.get("seriesId")).toBe("10");
    expect(url.searchParams.get("includeSeries")).toBe("false");
    expect(url.searchParams.get("includeEpisode")).toBe("false");
  });

  it("drops items from another series when the episode list is built", async () => {
    const episodes = await listEpisodeActivity(10, { includeMessages: false });
    expect(episodes.map((entry) => entry.id)).toEqual([101, 102, 103]);

    const other = await listEpisodeActivity(20, { includeMessages: false });
    expect(other.map((entry) => entry.id)).toEqual([201]);
  });

  it("gives requesters no messages on either list", async () => {
    const series = await listSeriesActivity({ includeMessages: false });
    const episodes = await listEpisodeActivity(20, { includeMessages: false });
    expect(series.every((entry) => entry.messages.length === 0)).toBe(true);
    expect(episodes.every((entry) => entry.messages.length === 0)).toBe(true);
  });

  it("gives admins the messages on the episode list", async () => {
    const [episode] = await listEpisodeActivity(20, { includeMessages: true });
    expect(episode.messages[0]).toBe("Sample import error text for episode 201.");
  });

  it("never returns the download id, path, indexer, client or release title on either list", async () => {
    const series = JSON.stringify(await listSeriesActivity({ includeMessages: true }));
    const episodes = JSON.stringify(await listEpisodeActivity(20, { includeMessages: true }));
    for (const entry of sonarrQueue) {
      for (const secret of [entry.downloadId, entry.outputPath, entry.indexer, entry.downloadClient, entry.title]) {
        if (typeof secret === "string" && secret !== "") {
          expect(series).not.toContain(secret);
          expect(episodes).not.toContain(secret);
        }
      }
    }
  });

  it("throws an invalid ArrRequestError when the reply is not a list", async () => {
    fetchMock.mockImplementation(async () => reply({ records: [] }));

    const error = await listSeriesActivity({ includeMessages: false }).then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
  });
});

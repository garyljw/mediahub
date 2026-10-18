import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as RadarrComponents } from "./generated/radarr";
import queueFixture from "./__fixtures__/radarr-queue-details.json";
import { ArrRequestError } from "./request";
import {
  MAX_ACTIVITY_MESSAGES,
  MAX_ACTIVITY_MESSAGE_CHARS,
  listMovieActivity,
  toMovieActivity,
} from "./activity";

type QueueResource = RadarrComponents["schemas"]["QueueResource"];

const queue = queueFixture as QueueResource[];

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

const ALLOWED_KEYS = ["count", "etaSeconds", "messages", "movieId", "progress", "severity", "state"].sort();

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

/** The activity for one item, with messages included. */
function one(overrides: Partial<QueueResource>, includeMessages = true) {
  const [entry] = toMovieActivity([item(overrides)], NOW, { includeMessages });
  return entry;
}

describe("toMovieActivity state", () => {
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

describe("toMovieActivity severity", () => {
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

  it("never lowers the severity Radarr gave", () => {
    expect(one({ trackedDownloadStatus: "error", status: "queued", trackedDownloadState: "downloading" }).severity).toBe("error");
    expect(one({ trackedDownloadStatus: "warning", status: "paused", trackedDownloadState: "downloading" }).severity).toBe("warning");
  });
});

describe("toMovieActivity progress", () => {
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

describe("toMovieActivity eta", () => {
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

describe("toMovieActivity messages", () => {
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

describe("toMovieActivity several items for one movie", () => {
  it("keeps one entry with the count, and takes the message from the most severe item", () => {
    const [entry] = toMovieActivity(
      [
        item({ id: 1, trackedDownloadStatus: "ok", errorMessage: null }),
        item({ id: 2, trackedDownloadStatus: "error", status: "failed", errorMessage: "Sample failure" }),
        item({ id: 3, trackedDownloadStatus: "warning", errorMessage: "Sample warning" }),
      ],
      NOW,
      { includeMessages: true },
    );
    expect(entry.count).toBe(3);
    expect(entry.severity).toBe("error");
    expect(entry.state).toBe("failed");
    expect(entry.messages).toEqual(["Sample failure"]);
  });

  it("keeps the earlier item when two items tie on severity", () => {
    const [entry] = toMovieActivity(
      [item({ id: 1, size: 1000, sizeleft: 100 }), item({ id: 2, size: 1000, sizeleft: 500 })],
      NOW,
      { includeMessages: false },
    );
    expect(entry.progress).toBe(90);
    expect(entry.count).toBe(2);
  });

  it("lets a warning item beat an ok item even when the ok item comes first", () => {
    const [entry] = toMovieActivity(
      [item({ id: 1, trackedDownloadStatus: "ok" }), item({ id: 2, status: "warning", trackedDownloadStatus: "ok" })],
      NOW,
      { includeMessages: false },
    );
    expect(entry.severity).toBe("warning");
  });

  it("returns entries in order of first appearance", () => {
    const result = toMovieActivity(
      [item({ id: 1, movieId: 5 }), item({ id: 2, movieId: 2 }), item({ id: 3, movieId: 5 }), item({ id: 4, movieId: 3 })],
      NOW,
      { includeMessages: false },
    );
    expect(result.map((entry) => entry.movieId)).toEqual([5, 2, 3]);
    expect(result.map((entry) => entry.count)).toEqual([2, 1, 1]);
  });
});

describe("toMovieActivity movie ids", () => {
  it.each([null, undefined, 0, -1, 1.5, Number.NaN])("skips an item whose movieId is %j", (movieId) => {
    expect(toMovieActivity([item({ movieId: movieId as number | null })], NOW, { includeMessages: false })).toEqual([]);
  });
});

describe("toMovieActivity on the fixture", () => {
  const result = toMovieActivity(queue, NOW, { includeMessages: false });
  const withMessages = toMovieActivity(queue, NOW, { includeMessages: true });

  it("reduces the fixture to one entry per valid movie, in order", () => {
    expect(result.map((entry) => entry.movieId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("maps the downloading item", () => {
    expect(result[0]).toEqual({
      movieId: 1,
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
    expect(result[5]).toMatchObject({ movieId: 6, state: "downloading", severity: "warning", count: 2 });
    expect(withMessages[5].messages).toEqual(["Sample indexer warning for the second release of movie six."]);
  });

  it("gives no progress or eta when sizeleft is larger than size", () => {
    expect(result[6]).toMatchObject({ movieId: 7, progress: null, etaSeconds: 5400 });
  });

  it("only ever returns the MovieActivity fields", () => {
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
    expect(withMessages.find((entry) => entry.movieId === 4)?.messages.length).toBeGreaterThan(0);
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

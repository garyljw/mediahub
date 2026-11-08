import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  markMovieHistoryFailed: vi.fn(),
  markEpisodeHistoryFailed: vi.fn(),
  refresh: vi.fn(),
}));

// AuthzError must be a real class: the action checks `instanceof AuthzError`.
vi.mock("@/server/authz", () => {
  class AuthzError extends Error {
    constructor(readonly status: 401 | 403) {
      super(status === 401 ? "unauthorized" : "forbidden");
      this.name = "AuthzError";
    }
  }
  return { AuthzError, requireRole: mocks.requireRole };
});

vi.mock("@/server/arr/history", () => ({
  markMovieHistoryFailed: mocks.markMovieHistoryFailed,
  markEpisodeHistoryFailed: mocks.markEpisodeHistoryFailed,
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import { AuthzError } from "@/server/authz";
import { markHistoryFailed } from "./actions";

const DENIED = "You don't have permission to mark downloads as failed.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.markMovieHistoryFailed.mockResolvedValue(undefined);
  mocks.markEpisodeHistoryFailed.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("markHistoryFailed authorization", () => {
  it("checks for the admin role only", async () => {
    await markHistoryFailed({ app: "radarr", historyId: 1 });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  // A signed-out caller (401) gets the same AuthzError branch as a requester (403), so one status is enough.
  it("refuses a requester and never calls Radarr or Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await markHistoryFailed({ app: "radarr", historyId: 1 })).toEqual({ ok: false, error: DENIED });
    expect(mocks.markMovieHistoryFailed).not.toHaveBeenCalled();
    expect(mocks.markEpisodeHistoryFailed).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(markHistoryFailed({ app: "radarr", historyId: 1 })).rejects.toThrow("database down");
    expect(mocks.markMovieHistoryFailed).not.toHaveBeenCalled();
  });
});

describe("markHistoryFailed input validation", () => {
  it.each([
    ["extra keys", { app: "radarr", historyId: 1, downloadUrl: "http://x" }],
    ["an unknown app", { app: "lidarr", historyId: 1 }],
    ["a zero id", { app: "radarr", historyId: 0 }],
    ["a negative id", { app: "sonarr", historyId: -3 }],
    ["a string id", { app: "radarr", historyId: "1" }],
    ["a fractional id", { app: "sonarr", historyId: 1.5 }],
    ["a missing id", { app: "radarr" }],
    ["not an object", "radarr"],
  ])("rejects %s without calling an Arr", async (_label, input) => {
    expect(await markHistoryFailed(input)).toEqual({ ok: false, error: "Invalid change." });
    expect(mocks.markMovieHistoryFailed).not.toHaveBeenCalled();
    expect(mocks.markEpisodeHistoryFailed).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("markHistoryFailed routing and results", () => {
  it.each([
    ["radarr", 12, "markMovieHistoryFailed", "markEpisodeHistoryFailed"],
    ["sonarr", 34, "markEpisodeHistoryFailed", "markMovieHistoryFailed"],
  ] as const)("marks a %s item through its own function, then refreshes", async (app, historyId, called, other) => {
    expect(await markHistoryFailed({ app, historyId })).toEqual({ ok: true });
    expect(mocks[called]).toHaveBeenCalledWith(historyId);
    expect(mocks[other]).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  // Each row is a branch of writeFailureMessage. A timeout or a 5xx may have been done, so those rows say so.
  it.each([
    [
      "radarr",
      "markMovieHistoryFailed",
      new ArrRequestError("Radarr mark failed request failed: HTTP 404", "http", 404),
      "Radarr didn't accept it. Try again.",
    ],
    [
      "sonarr",
      "markEpisodeHistoryFailed",
      new ArrRequestError("Sonarr mark failed request failed: timed out", "timeout"),
      "Sonarr didn't confirm it. It may still have been marked failed, so reload the page to check.",
    ],
    [
      "radarr",
      "markMovieHistoryFailed",
      new ArrRequestError("Radarr mark failed request failed: HTTP 500", "http", 500),
      "Radarr didn't confirm it. It may still have been marked failed, so reload the page to check.",
    ],
  ] as const)("says what happened for %s and does not refresh", async (app, upstream, error, message) => {
    mocks[upstream].mockRejectedValue(error);

    expect(await markHistoryFailed({ app, historyId: 12 })).toEqual({ ok: false, error: message });
    expect(console.error).toHaveBeenCalledWith(`History mark failed: ${error.message}`);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not Arr request failures", async () => {
    mocks.markEpisodeHistoryFailed.mockRejectedValue(new Error("bug"));

    await expect(markHistoryFailed({ app: "sonarr", historyId: 34 })).rejects.toThrow("bug");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

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

  it("rejects a requester and never calls Radarr or Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    const result = await markHistoryFailed({ app: "radarr", historyId: 1 });

    expect(result).toEqual({ ok: false, error: DENIED });
    expect(mocks.markMovieHistoryFailed).not.toHaveBeenCalled();
    expect(mocks.markEpisodeHistoryFailed).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    expect(await markHistoryFailed({ app: "sonarr", historyId: 1 })).toEqual({ ok: false, error: DENIED });
    expect(mocks.markEpisodeHistoryFailed).not.toHaveBeenCalled();
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
  it("marks a Radarr item through the movie function, then refreshes", async () => {
    expect(await markHistoryFailed({ app: "radarr", historyId: 12 })).toEqual({ ok: true });
    expect(mocks.markMovieHistoryFailed).toHaveBeenCalledWith(12);
    expect(mocks.markEpisodeHistoryFailed).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("marks a Sonarr item through the episode function, then refreshes", async () => {
    expect(await markHistoryFailed({ app: "sonarr", historyId: 34 })).toEqual({ ok: true });
    expect(mocks.markEpisodeHistoryFailed).toHaveBeenCalledWith(34);
    expect(mocks.markMovieHistoryFailed).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("says the app didn't accept a 4xx, names it, logs only the safe message, and does not refresh", async () => {
    mocks.markMovieHistoryFailed.mockRejectedValue(
      new ArrRequestError("Radarr mark failed request failed: HTTP 404", "http", 404),
    );

    const result = await markHistoryFailed({ app: "radarr", historyId: 12 });

    expect(result).toEqual({ ok: false, error: "Radarr didn't accept it. Try again." });
    expect(console.error).toHaveBeenCalledWith("History mark failed: Radarr mark failed request failed: HTTP 404");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says Sonarr didn't confirm a timeout and that the item may have been marked", async () => {
    mocks.markEpisodeHistoryFailed.mockRejectedValue(
      new ArrRequestError("Sonarr mark failed request failed: timed out", "timeout"),
    );

    const result = await markHistoryFailed({ app: "sonarr", historyId: 34 });

    expect(result).toEqual({
      ok: false,
      error: "Sonarr didn't confirm it. It may still have been marked failed, so reload the page to check.",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says Radarr didn't confirm a 5xx, since it may have been done", async () => {
    mocks.markMovieHistoryFailed.mockRejectedValue(
      new ArrRequestError("Radarr mark failed request failed: HTTP 500", "http", 500),
    );

    expect(await markHistoryFailed({ app: "radarr", historyId: 12 })).toEqual({
      ok: false,
      error: "Radarr didn't confirm it. It may still have been marked failed, so reload the page to check.",
    });
  });

  it("rethrows errors that are not Arr request failures", async () => {
    mocks.markEpisodeHistoryFailed.mockRejectedValue(new Error("bug"));

    await expect(markHistoryFailed({ app: "sonarr", historyId: 34 })).rejects.toThrow("bug");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  addToFocus: vi.fn(),
  listFocusIds: vi.fn(),
  removeFromFocus: vi.fn(),
  reorderFocus: vi.fn(),
  movieExists: vi.fn(),
  seriesExists: vi.fn(),
}));

vi.mock("@/server/authz", () => {
  class AuthzError extends Error {
    constructor(readonly status: 401 | 403) {
      super(status === 401 ? "unauthorized" : "forbidden");
      this.name = "AuthzError";
    }
  }
  return { AuthzError, requireRole: mocks.requireRole };
});

vi.mock("@/server/arr/movies", () => ({ movieExists: mocks.movieExists }));
vi.mock("@/server/arr/series", () => ({ seriesExists: mocks.seriesExists }));

vi.mock("@/server/focus/focus", () => {
  class FocusOrderError extends Error {}
  class FocusLimitError extends Error {}
  return {
    MAX_FOCUS_ITEMS: 500,
    FocusOrderError,
    FocusLimitError,
    addToFocus: mocks.addToFocus,
    listFocusIds: mocks.listFocusIds,
    removeFromFocus: mocks.removeFromFocus,
    reorderFocus: mocks.reorderFocus,
  };
});

import { AuthzError } from "@/server/authz";
import { ArrRequestError } from "@/server/arr/request";
import { FocusLimitError, FocusOrderError } from "@/server/focus/focus";
import { addFocusItem, removeFocusItems, reorderFocusItems } from "./actions";

const REQUESTER = { id: "u1", email: "r@example.test", name: "R", role: "requester" };
const DENIED = "You don't have permission to change Focus lists.";
const INVALID = "That change couldn't be read. Refresh and try again.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: REQUESTER });
  mocks.listFocusIds.mockReturnValue([]);
  mocks.movieExists.mockResolvedValue(true);
  mocks.seriesExists.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const signedOut = () => mocks.requireRole.mockRejectedValue(new AuthzError(401));
const forbidden = () => mocks.requireRole.mockRejectedValue(new AuthzError(403));

describe("addFocusItem", () => {
  it("allows both admin and requester, checks the title in its own app, and adds it as the caller", async () => {
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: true });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
    expect(mocks.movieExists).toHaveBeenCalledWith(4);
    expect(mocks.seriesExists).not.toHaveBeenCalled();
    expect(mocks.addToFocus).toHaveBeenCalledWith("movie", 4, "u1");
  });

  it("checks Sonarr for a series", async () => {
    expect(await addFocusItem({ kind: "series", id: 9 })).toEqual({ ok: true });
    expect(mocks.seriesExists).toHaveBeenCalledWith(9);
    expect(mocks.movieExists).not.toHaveBeenCalled();
  });

  it.each([
    ["signed out", signedOut],
    ["a forbidden role", forbidden],
  ])("refuses %s and writes nothing", async (_label, deny) => {
    deny();
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: false, error: DENIED });
    expect(mocks.addToFocus).not.toHaveBeenCalled();
    expect(mocks.movieExists).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown kind", { kind: "music", id: 4 }],
    ["a zero id", { kind: "movie", id: 0 }],
    ["a negative id", { kind: "movie", id: -4 }],
    ["a fractional id", { kind: "movie", id: 1.5 }],
    ["a string id", { kind: "movie", id: "4" }],
    ["an extra key", { kind: "movie", id: 4, user: "x" }],
    ["a missing id", { kind: "movie" }],
    ["a non-object", "movie:4"],
  ])("refuses %s without calling the app or writing", async (_label, input) => {
    expect(await addFocusItem(input)).toEqual({ ok: false, error: INVALID });
    expect(mocks.movieExists).not.toHaveBeenCalled();
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it("refuses a title the app doesn't have, and writes nothing", async () => {
    mocks.movieExists.mockResolvedValue(false);
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: false, error: "That title isn't in Radarr." });
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it("refuses a series Sonarr doesn't have, naming Sonarr", async () => {
    mocks.seriesExists.mockResolvedValue(false);
    expect(await addFocusItem({ kind: "series", id: 4 })).toEqual({ ok: false, error: "That title isn't in Sonarr." });
  });

  it("reports an app outage with the safe message and logs only the error message", async () => {
    mocks.movieExists.mockRejectedValue(new ArrRequestError("Radarr movie request failed: HTTP 503", "http", 503));
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: false, error: "Couldn't reach Radarr. Try again." });
    expect(console.error).toHaveBeenCalledWith("Focus add: Radarr movie request failed: HTTP 503");
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it("names Sonarr in the outage message for a series", async () => {
    mocks.seriesExists.mockRejectedValue(new ArrRequestError("Sonarr series request failed", "http", 500));
    expect(await addFocusItem({ kind: "series", id: 4 })).toEqual({ ok: false, error: "Couldn't reach Sonarr. Try again." });
  });

  it("rethrows errors that are not Arr request failures", async () => {
    mocks.movieExists.mockRejectedValue(new Error("config broken"));
    await expect(addFocusItem({ kind: "movie", id: 1 })).rejects.toThrow("config broken");
  });

  it("is a no-op success for a title already in the list, without asking the app", async () => {
    mocks.listFocusIds.mockReturnValue([4, 9]);
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: true });
    expect(mocks.movieExists).not.toHaveBeenCalled();
    expect(mocks.addToFocus).toHaveBeenCalledWith("movie", 4, "u1");
  });

  it("shows the limit message when the list is full", async () => {
    mocks.addToFocus.mockImplementation(() => {
      throw new FocusLimitError();
    });
    expect((await addFocusItem({ kind: "series", id: 9 })).ok).toBe(false);
  });
});

describe.each([
  ["removeFocusItems", removeFocusItems],
] as const)("%s", (_name, action) => {
  it("allows both admin and requester and removes the ids of that kind", async () => {
    expect(await action({ kind: "movie", ids: [4, 5] })).toEqual({ ok: true });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
    expect(mocks.removeFromFocus).toHaveBeenCalledWith("movie", [4, 5]);
  });

  it.each([
    ["signed out", signedOut],
    ["a forbidden role", forbidden],
  ])("refuses %s and removes nothing", async (_label, deny) => {
    deny();
    expect(await action({ kind: "movie", ids: [4] })).toEqual({ ok: false, error: DENIED });
    expect(mocks.removeFromFocus).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty id list", { kind: "movie", ids: [] }],
    ["duplicate ids", { kind: "movie", ids: [1, 1] }],
    ["a negative id", { kind: "movie", ids: [1, -2] }],
    ["an extra key", { kind: "movie", ids: [1], user: "x" }],
    ["an unknown kind", { kind: "book", ids: [1] }],
    ["too many ids", { kind: "movie", ids: Array.from({ length: 501 }, (_, i) => i + 1) }],
  ])("refuses %s without removing", async (_label, input) => {
    expect(await action(input)).toEqual({ ok: false, error: INVALID });
    expect(mocks.removeFromFocus).not.toHaveBeenCalled();
  });
});

describe("reorderFocusItems", () => {
  it("writes the new full order for the kind", async () => {
    expect(await reorderFocusItems({ kind: "movie", ids: [3, 1, 2] })).toEqual({ ok: true });
    expect(mocks.reorderFocus).toHaveBeenCalledWith("movie", [3, 1, 2]);
  });

  it("allows an empty list", async () => {
    expect(await reorderFocusItems({ kind: "series", ids: [] })).toEqual({ ok: true });
  });

  it("refuses a stale order with the list-changed message and flags it as stale", async () => {
    mocks.reorderFocus.mockImplementation(() => {
      throw new FocusOrderError();
    });
    expect(await reorderFocusItems({ kind: "movie", ids: [1, 2] })).toEqual({
      ok: false,
      error: "The list changed. Refresh and try again.",
      stale: true,
    });
  });

  it.each([
    ["duplicate ids", { kind: "movie", ids: [1, 1] }],
    ["a negative id", { kind: "movie", ids: [1, -2] }],
    ["an extra key", { kind: "movie", ids: [1], order: "x" }],
    ["an unknown kind", { kind: "book", ids: [1] }],
    ["too many ids", { kind: "movie", ids: Array.from({ length: 501 }, (_, i) => i + 1) }],
  ])("refuses %s without writing", async (_label, input) => {
    expect(await reorderFocusItems(input)).toEqual({ ok: false, error: INVALID });
    expect(mocks.reorderFocus).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    signedOut();
    expect(await reorderFocusItems({ kind: "movie", ids: [1] })).toEqual({ ok: false, error: DENIED });
    expect(mocks.reorderFocus).not.toHaveBeenCalled();
  });
});

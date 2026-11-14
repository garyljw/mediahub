import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getTmdbConfig: vi.fn(),
  getTvdbId: vi.fn(),
  addSeriesAs: vi.fn(),
  refresh: vi.fn(),
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
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/server/settings/tmdb", () => ({ getTmdbConfig: mocks.getTmdbConfig }));
vi.mock("@/server/tmdb/client", () => ({ getTvdbId: mocks.getTvdbId }));
vi.mock("@/server/add/series-add", () => ({ addSeriesAs: mocks.addSeriesAs }));

import { AuthzError } from "@/server/authz";
import { TmdbRequestError } from "@/server/tmdb/errors";
import { addPopularSeries } from "./actions";

const TOKEN = "fake-tmdb-token-0123456789abcdef";
const ADMIN_INPUT = {
  tmdbId: 84773,
  qualityProfileId: 1,
  rootFolderId: 2,
  monitor: "all",
  seriesType: "standard",
  seasonFolder: true,
  searchForMissingEpisodes: true,
};

function asRole(role: "admin" | "requester") {
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", role } });
}

beforeEach(() => {
  vi.clearAllMocks();
  asRole("requester");
  mocks.getTmdbConfig.mockReturnValue({ token: TOKEN, region: "GB" });
  mocks.getTvdbId.mockResolvedValue(367506);
  mocks.addSeriesAs.mockResolvedValue({ ok: true, id: 5, title: "Fake Show", year: 2022 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("addPopularSeries authorization", () => {
  it.each([
    ["an admin", "admin", ADMIN_INPUT],
    ["a requester", "requester", { tmdbId: 84773 }],
  ] as const)("checks both roles, and lets %s through", async (_name, role, input) => {
    asRole(role);
    await addPopularSeries(input);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
  });

  it("returns the denial and calls neither TMDB nor Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));
    expect(await addPopularSeries({ tmdbId: 1 })).toEqual({ ok: false, error: "You don't have permission to add series." });
    expect(mocks.getTvdbId).not.toHaveBeenCalled();
    expect(mocks.addSeriesAs).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("db down"));
    await expect(addPopularSeries({ tmdbId: 1 })).rejects.toThrow("db down");
  });
});

describe("addPopularSeries input", () => {
  it.each([
    ["a requester sending an admin field", "requester", { tmdbId: 1, qualityProfileId: 1 }],
    ["a requester sending a TVDB id", "requester", { tmdbId: 1, tvdbId: 5 }],
    ["a zero id", "requester", { tmdbId: 0 }],
    ["an id past any real TMDB id", "requester", { tmdbId: 100_000_001 }],
    ["a fractional id", "requester", { tmdbId: 1.5 }],
    ["a string id", "requester", { tmdbId: "84773" }],
    ["no id", "requester", {}],
    ["an admin missing a choice", "admin", { tmdbId: 1 }],
    ["an admin sending an unknown key", "admin", { ...ADMIN_INPUT, tvdbId: 5 }],
    ["an unknown monitor", "admin", { ...ADMIN_INPUT, monitor: "everything" }],
  ] as const)("refuses %s before any upstream call", async (_name, role, input) => {
    asRole(role);
    expect(await addPopularSeries(input)).toEqual({ ok: false, error: "Invalid add." });
    expect(mocks.getTvdbId).not.toHaveBeenCalled();
    expect(mocks.addSeriesAs).not.toHaveBeenCalled();
  });
});

describe("addPopularSeries", () => {
  it("looks up the TVDB id with the saved token and passes it, with the admin's choices, to the Sonarr add", async () => {
    asRole("admin");
    const result = await addPopularSeries(ADMIN_INPUT);
    expect(mocks.getTvdbId).toHaveBeenCalledWith(TOKEN, 84773);
    const { tmdbId, ...choices } = ADMIN_INPUT;
    void tmdbId;
    expect(mocks.addSeriesAs).toHaveBeenCalledWith(true, { ...choices, tvdbId: 367506 });
    expect(result).toEqual({ ok: true, id: 5, title: "Fake Show", year: 2022 });
  });

  it("sends a requester's add with only the TVDB id", async () => {
    await addPopularSeries({ tmdbId: 84773 });
    expect(mocks.addSeriesAs).toHaveBeenCalledWith(false, { tvdbId: 367506 });
  });

  it("says so, and does not call Sonarr, when TMDB has no TVDB id", async () => {
    mocks.getTvdbId.mockResolvedValue(null);
    expect(await addPopularSeries({ tmdbId: 1 })).toEqual({
      ok: false,
      error: "Sonarr can't add this show yet (no TVDB entry).",
    });
    expect(mocks.addSeriesAs).not.toHaveBeenCalled();
  });

  it("says TMDB isn't set up, without any call, when no token is saved", async () => {
    mocks.getTmdbConfig.mockReturnValue(null);
    expect(await addPopularSeries({ tmdbId: 1 })).toEqual({ ok: false, error: "TMDB isn't set up." });
    expect(mocks.getTvdbId).not.toHaveBeenCalled();
    expect(mocks.addSeriesAs).not.toHaveBeenCalled();
  });

  it.each([
    ["a busy TMDB", new TmdbRequestError("x", "http", 429), "TMDB is busy, try again shortly."],
    ["a timeout", new TmdbRequestError("x", "timeout"), "TMDB took too long to answer. Try again."],
    ["an unreadable reply", new TmdbRequestError("x", "invalid"), "TMDB sent a reply MediaHub couldn't read."],
    ["a network failure", new TmdbRequestError("x", "network"), "Couldn't reach TMDB. Try again."],
    ["any other status", new TmdbRequestError("x", "http", 500), "TMDB couldn't answer. Try again."],
  ])("gives the user's message for %s, and does not call Sonarr", async (_name, error, message) => {
    mocks.getTvdbId.mockRejectedValue(error);
    expect(await addPopularSeries({ tmdbId: 1 })).toEqual({ ok: false, error: message });
    expect(mocks.addSeriesAs).not.toHaveBeenCalled();
  });

  it.each([
    ["an admin", "admin", ADMIN_INPUT, "TMDB no longer accepts the saved token."],
    ["a requester", "requester", { tmdbId: 1 }, "Popular can't reach TMDB right now. Ask the admin to check the TMDB token."],
  ] as const)("words a refused token for %s", async (_name, role, input, message) => {
    asRole(role);
    mocks.getTvdbId.mockRejectedValue(new TmdbRequestError("x", "http", 401));
    expect(await addPopularSeries(input)).toEqual({ ok: false, error: message });
    expect(mocks.addSeriesAs).not.toHaveBeenCalled();
  });

  it("logs only the safe error text, never the token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getTvdbId.mockRejectedValue(new TmdbRequestError("TMDB external ids request failed: HTTP 401", "http", 401));
    await addPopularSeries({ tmdbId: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("Popular add: TMDB external ids request failed: HTTP 401");
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
  });

  it("rethrows an error that is not a TMDB request failure", async () => {
    mocks.getTvdbId.mockRejectedValue(new Error("boom"));
    await expect(addPopularSeries({ tmdbId: 1 })).rejects.toThrow("boom");
  });
});

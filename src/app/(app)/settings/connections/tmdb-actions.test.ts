import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  validateToken: vi.fn(),
  fetchRegions: vi.fn(),
  getTmdbConfig: vi.fn(),
  saveTmdbConfig: vi.fn(),
  removeTmdbConfig: vi.fn(),
  revalidatePath: vi.fn(),
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
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/tmdb/client", async () => {
  const errors = await import("@/server/tmdb/errors");
  return { TmdbRequestError: errors.TmdbRequestError, validateToken: mocks.validateToken, fetchRegions: mocks.fetchRegions };
});
vi.mock("@/server/settings/tmdb", () => ({
  getTmdbConfig: mocks.getTmdbConfig,
  saveTmdbConfig: mocks.saveTmdbConfig,
  removeTmdbConfig: mocks.removeTmdbConfig,
}));

import { AuthzError } from "@/server/authz";
import { TmdbRequestError } from "@/server/tmdb/errors";
import { removeTmdbSettings, saveTmdbSettings } from "./tmdb-actions";

const TOKEN = "fake-tmdb-token-0123456789abcdef";
const DENIED = "You don't have permission to change connections.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", role: "admin" } });
  mocks.validateToken.mockResolvedValue(undefined);
  mocks.fetchRegions.mockResolvedValue([
    { code: "GB", name: "United Kingdom" },
    { code: "US", name: "United States of America" },
  ]);
  mocks.getTmdbConfig.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ACTIONS: [string, () => Promise<unknown>][] = [
  ["saveTmdbSettings", () => saveTmdbSettings({ token: TOKEN, region: "GB", language: "en" })],
  ["removeTmdbSettings", () => removeTmdbSettings()],
];

describe.each(ACTIONS)("%s authorization", (_name, run) => {
  it("checks for the admin role", async () => {
    await run();
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("returns the denial and touches neither TMDB nor the database", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));
    expect(await run()).toEqual({ ok: false, message: DENIED });
    expect(mocks.validateToken).not.toHaveBeenCalled();
    expect(mocks.saveTmdbConfig).not.toHaveBeenCalled();
    expect(mocks.removeTmdbConfig).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("db down"));
    await expect(run()).rejects.toThrow("db down");
  });
});

describe("saveTmdbSettings", () => {
  it.each([
    ["a lower-case country", { token: TOKEN, region: "gb", language: "en" }],
    ["a three-letter country", { token: TOKEN, region: "GBR", language: "en" }],
    ["no country", { token: TOKEN, language: "en" }],
    ["no language", { token: TOKEN, region: "GB" }],
    ["an unknown language", { token: TOKEN, region: "GB", language: "xx" }],
    ["a non-string token", { token: 5, region: "GB", language: "en" }],
    ["an over-long token", { token: "x".repeat(2001), region: "GB", language: "en" }],
    ["an extra key", { token: TOKEN, region: "GB", language: "en", extra: 1 }],
    ["not an object", "nope"],
  ])("refuses %s before any call", async (_name, input) => {
    expect(await saveTmdbSettings(input)).toMatchObject({ ok: false });
    expect(mocks.validateToken).not.toHaveBeenCalled();
    expect(mocks.saveTmdbConfig).not.toHaveBeenCalled();
  });

  it("validates a trimmed token with TMDB and stores it", async () => {
    expect(await saveTmdbSettings({ token: `  ${TOKEN}  `, region: "US", language: "en" })).toEqual({ ok: true });
    expect(mocks.validateToken).toHaveBeenCalledWith(TOKEN);
    expect(mocks.saveTmdbConfig).toHaveBeenCalledWith({ token: TOKEN, region: "US", language: "en" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/connections");
  });

  it("refuses a country TMDB doesn't list, and a failing country list, and stores nothing", async () => {
    expect(await saveTmdbSettings({ token: TOKEN, region: "ZZ", language: "en" })).toEqual({ ok: false, message: "Pick a country from the list." });
    mocks.fetchRegions.mockRejectedValue(new TmdbRequestError("TMDB regions request failed: HTTP 429", "http", 429));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveTmdbSettings({ token: TOKEN, region: "GB", language: "en" })).toEqual({ ok: false, message: "TMDB is busy, try again shortly." });
    expect(mocks.saveTmdbConfig).not.toHaveBeenCalled();
  });

  it("keeps the stored token when the field is blank, without calling TMDB", async () => {
    mocks.getTmdbConfig.mockReturnValue({ token: TOKEN, region: "GB", language: "en" });
    expect(await saveTmdbSettings({ token: "  ", region: "US", language: "en" })).toEqual({ ok: true });
    expect(mocks.validateToken).not.toHaveBeenCalled();
    expect(mocks.saveTmdbConfig).toHaveBeenCalledWith({ token: TOKEN, region: "US", language: "en" });
  });

  it("asks for a token when blank and none is stored", async () => {
    expect(await saveTmdbSettings({ token: "", region: "GB", language: "en" })).toEqual({ ok: false, message: "Paste the Read Access Token." });
    expect(mocks.saveTmdbConfig).not.toHaveBeenCalled();
  });

  it.each([
    ["a refused token", new TmdbRequestError("TMDB authentication request failed: HTTP 401", "http", 401), "TMDB didn't accept that token."],
    ["a busy TMDB", new TmdbRequestError("TMDB authentication request failed: HTTP 429", "http", 429), "TMDB is busy, try again shortly."],
    ["a timeout", new TmdbRequestError("TMDB authentication request failed: timed out", "timeout"), "TMDB took too long to answer. Try again."],
    ["a network error", new TmdbRequestError("TMDB authentication request failed: network error", "network"), "Couldn't reach TMDB. Try again."],
    ["an unreadable reply", new TmdbRequestError("TMDB authentication request failed: invalid response", "invalid"), "TMDB sent a reply MediaHub couldn't read."],
  ])("shows the right message for %s and stores nothing", async (_name, error, message) => {
    mocks.validateToken.mockRejectedValue(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveTmdbSettings({ token: TOKEN, region: "GB", language: "en" })).toEqual({ ok: false, message });
    expect(mocks.saveTmdbConfig).not.toHaveBeenCalled();
    // Only the safe message is logged: never the token.
    expect(log).toHaveBeenCalledWith(error.message);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it("rethrows an unexpected error from TMDB validation", async () => {
    mocks.validateToken.mockRejectedValue(new Error("bug"));
    await expect(saveTmdbSettings({ token: TOKEN, region: "GB", language: "en" })).rejects.toThrow("bug");
  });
});

describe("removeTmdbSettings", () => {
  it("removes the stored values", async () => {
    expect(await removeTmdbSettings()).toEqual({ ok: true });
    expect(mocks.removeTmdbConfig).toHaveBeenCalled();
  });
});

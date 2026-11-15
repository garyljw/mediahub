import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getProviders: vi.fn(),
  getTmdbConfig: vi.fn(),
  saveChosenServices: vi.fn(),
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
  return { TmdbRequestError: errors.TmdbRequestError, getProviders: mocks.getProviders };
});
vi.mock("@/server/settings/tmdb", () => ({
  getTmdbConfig: mocks.getTmdbConfig,
  saveChosenServices: mocks.saveChosenServices,
}));

import { AuthzError } from "@/server/authz";
import { TmdbRequestError } from "@/server/tmdb/errors";
import { savePopularServices } from "./actions";

const TOKEN = "fake-tmdb-token-0123456789abcdef";
const provider = (id: number) => ({ id, name: `Service ${id}`, logoPath: null, displayPriority: id, displayPriorities: {} });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", role: "admin" } });
  mocks.getTmdbConfig.mockReturnValue({ token: TOKEN, region: "GB", language: "en" });
  mocks.getProviders.mockImplementation(async (_token: string, kind: string) =>
    kind === "movie" ? [provider(8), provider(9)] : [provider(8), provider(337)],
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("savePopularServices authorization", () => {
  it("checks for the admin role", async () => {
    await savePopularServices({ ids: [8] });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("returns the denial and touches neither TMDB nor the database", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));
    expect(await savePopularServices({ ids: [8] })).toEqual({
      ok: false,
      message: "You don't have permission to change Popular settings.",
    });
    expect(mocks.getProviders).not.toHaveBeenCalled();
    expect(mocks.saveChosenServices).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("db down"));
    await expect(savePopularServices({ ids: [8] })).rejects.toThrow("db down");
  });
});

describe("savePopularServices", () => {
  it.each([
    ["not an object", "nope"],
    ["an extra key", { ids: [8], extra: 1 }],
    ["ids that aren't an array", { ids: 8 }],
    ["zero", { ids: [0] }],
    ["a negative id", { ids: [-1] }],
    ["a fractional id", { ids: [1.5] }],
    ["a string id", { ids: ["8"] }],
    ["duplicates", { ids: [8, 8] }],
    ["51 ids", { ids: Array.from({ length: 51 }, (_, i) => i + 1) }],
  ])("refuses %s before any call", async (_name, input) => {
    expect(await savePopularServices(input)).toEqual({ ok: false, message: "Pick services from the list." });
    expect(mocks.getProviders).not.toHaveBeenCalled();
    expect(mocks.saveChosenServices).not.toHaveBeenCalled();
  });

  it("saves an empty list without asking TMDB", async () => {
    expect(await savePopularServices({ ids: [] })).toEqual({ ok: true });
    expect(mocks.getProviders).not.toHaveBeenCalled();
    expect(mocks.saveChosenServices).toHaveBeenCalledWith([]);
  });

  it("accepts a service offered only for TV, and saves the ids in the given order", async () => {
    expect(await savePopularServices({ ids: [337, 9, 8] })).toEqual({ ok: true });
    expect(mocks.saveChosenServices).toHaveBeenCalledWith([337, 9, 8]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/popular");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/popular");
  });

  it("refuses an id TMDB doesn't offer and saves nothing", async () => {
    expect(await savePopularServices({ ids: [8, 4242] })).toEqual({
      ok: false,
      message: "That service isn't offered in your country any more. Reload and try again.",
    });
    expect(mocks.saveChosenServices).not.toHaveBeenCalled();
  });

  it("asks for a TMDB token when none is stored", async () => {
    mocks.getTmdbConfig.mockReturnValue(null);
    expect(await savePopularServices({ ids: [8] })).toEqual({
      ok: false,
      message: "Add a TMDB token in Settings → Connections first.",
    });
    expect(mocks.getProviders).not.toHaveBeenCalled();
    expect(mocks.saveChosenServices).not.toHaveBeenCalled();
  });

  it("shows TMDB's failure text, logs only the safe message, and saves nothing", async () => {
    const error = new TmdbRequestError("TMDB providers request failed: HTTP 429", "http", 429);
    mocks.getProviders.mockRejectedValue(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await savePopularServices({ ids: [8] })).toEqual({ ok: false, message: "TMDB is busy, try again shortly." });
    expect(mocks.saveChosenServices).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(error.message);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it("rethrows an unexpected error from TMDB", async () => {
    mocks.getProviders.mockRejectedValue(new Error("bug"));
    await expect(savePopularServices({ ids: [8] })).rejects.toThrow("bug");
  });
});

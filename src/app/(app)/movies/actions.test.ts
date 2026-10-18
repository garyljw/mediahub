import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  editMovies: vi.fn(),
  listQualityProfiles: vi.fn(),
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

vi.mock("@/server/arr/movies", () => ({
  editMovies: mocks.editMovies,
  listQualityProfiles: mocks.listQualityProfiles,
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import { AuthzError } from "@/server/authz";
import { updateMovies } from "./actions";

const DENIED = "You don't have permission to edit movies.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.editMovies.mockResolvedValue(undefined);
  mocks.listQualityProfiles.mockResolvedValue([
    { id: 1, name: "HD-1080p" },
    { id: 2, name: "Any" },
  ]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("updateMovies authorization", () => {
  it("checks for the admin role", async () => {
    await updateMovies({ movieIds: [1], monitored: true });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    const result = await updateMovies({ movieIds: [1], monitored: true });

    expect(result).toEqual({ ok: false, error: DENIED });
    expect(mocks.editMovies).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    const result = await updateMovies({ movieIds: [1], monitored: true });

    expect(result).toEqual({ ok: false, error: DENIED });
    expect(mocks.editMovies).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(updateMovies({ movieIds: [1], monitored: true })).rejects.toThrow("database down");
    expect(mocks.editMovies).not.toHaveBeenCalled();
  });
});

describe("updateMovies input validation", () => {
  const invalid: [string, unknown][] = [
    ["not an object", "movies"],
    ["null", null],
    ["empty movieIds", { movieIds: [], monitored: true }],
    ["a negative id", { movieIds: [-1], monitored: true }],
    ["a zero id", { movieIds: [0], monitored: true }],
    ["a string id", { movieIds: ["1"], monitored: true }],
    ["a fractional id", { movieIds: [1.5], monitored: true }],
    ["an unknown key", { movieIds: [1], monitored: true, deleteFiles: true }],
    ["no change fields", { movieIds: [1] }],
    ["a string profile id", { movieIds: [1], qualityProfileId: "2" }],
    ["a non-boolean monitored", { movieIds: [1], monitored: "yes" }],
    ["more than 2000 ids", { movieIds: Array.from({ length: 2001 }, (_, i) => i + 1), monitored: true }],
  ];

  it.each(invalid)("rejects %s without calling Radarr", async (_name, input) => {
    const result = await updateMovies(input);

    expect(result).toEqual({ ok: false, error: "Invalid edit." });
    expect(mocks.editMovies).not.toHaveBeenCalled();
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("accepts exactly 2000 ids", async () => {
    const movieIds = Array.from({ length: 2000 }, (_, i) => i + 1);
    const result = await updateMovies({ movieIds, monitored: true });
    expect(result).toEqual({ ok: true });
    expect(mocks.editMovies).toHaveBeenCalledWith({ movieIds, monitored: true });
  });

  it("does not put Zod details in the error", async () => {
    const result = await updateMovies({ movieIds: [-1], monitored: true });
    expect(JSON.stringify(result)).not.toMatch(/Too small|received|issues|path/);
  });
});

describe("updateMovies edits", () => {
  it("de-duplicates ids before calling Radarr", async () => {
    await updateMovies({ movieIds: [3, 1, 3, 2, 1], monitored: false });
    expect(mocks.editMovies).toHaveBeenCalledWith({ movieIds: [3, 1, 2], monitored: false });
  });

  it("checks that a chosen quality profile still exists", async () => {
    const result = await updateMovies({ movieIds: [1], qualityProfileId: 99 });

    expect(result).toEqual({ ok: false, error: "That quality profile no longer exists." });
    expect(mocks.editMovies).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not check the profile list when no profile is chosen", async () => {
    await updateMovies({ movieIds: [1], monitored: true });
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
  });

  it("gives the friendly error when Radarr rejects the edit, and logs only the safe message", async () => {
    mocks.editMovies.mockRejectedValue(new ArrRequestError("Radarr movie edit request failed: HTTP 500"));

    const result = await updateMovies({ movieIds: [1], monitored: true });

    expect(result).toEqual({ ok: false, error: "Radarr didn't accept the change. Try again." });
    expect(console.error).toHaveBeenCalledWith("Movie edit: Radarr movie edit request failed: HTTP 500");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error when the profile list cannot be fetched", async () => {
    mocks.listQualityProfiles.mockRejectedValue(new ArrRequestError("Radarr quality profile request failed: timed out"));

    const result = await updateMovies({ movieIds: [1], qualityProfileId: 1 });

    expect(result).toEqual({ ok: false, error: "Radarr didn't accept the change. Try again." });
    expect(mocks.editMovies).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not Radarr request failures", async () => {
    mocks.editMovies.mockRejectedValue(new Error("config broken"));
    await expect(updateMovies({ movieIds: [1], monitored: true })).rejects.toThrow("config broken");
  });

  it("on success calls editMovies with exactly the validated fields, then refreshes", async () => {
    const result = await updateMovies({ movieIds: [5, 6], qualityProfileId: 2, monitored: true });

    expect(result).toEqual({ ok: true });
    expect(mocks.editMovies).toHaveBeenCalledTimes(1);
    expect(mocks.editMovies.mock.calls[0][0]).toStrictEqual({ movieIds: [5, 6], qualityProfileId: 2, monitored: true });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("omits fields that were not sent", async () => {
    await updateMovies({ movieIds: [5], qualityProfileId: 1 });
    expect(mocks.editMovies.mock.calls[0][0]).toStrictEqual({ movieIds: [5], qualityProfileId: 1 });
  });
});

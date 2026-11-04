import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  deleteMovies: vi.fn(),
  editMovie: vi.fn(),
  listQualityProfiles: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
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
  deleteMovies: mocks.deleteMovies,
  editMovie: mocks.editMovie,
  listQualityProfiles: mocks.listQualityProfiles,
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

// redirect throws in Next, so the mock does too. A test can then tell a redirect from a returned result.
vi.mock("next/navigation", () => ({
  RedirectType: { push: "push", replace: "replace" },
  redirect: (path: string, type?: string) => {
    mocks.redirect(path, type);
    throw new Error(`NEXT_REDIRECT ${path}`);
  },
}));

import { AuthzError } from "@/server/authz";
import { deleteMovie, updateMovie } from "./actions";

const DENIED = "You don't have permission to delete movies.";
const INVALID = "Invalid delete.";
const valid = { movieId: 7, deleteFiles: false, addImportExclusion: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.deleteMovies.mockResolvedValue(undefined);
  mocks.editMovie.mockResolvedValue(undefined);
  mocks.listQualityProfiles.mockResolvedValue([
    { id: 1, name: "HD-1080p" },
    { id: 2, name: "Any" },
  ]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteMovie authorization", () => {
  it("checks for the admin role only", async () => {
    await expect(deleteMovie(valid)).rejects.toThrow("NEXT_REDIRECT /");
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Radarr or redirects", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await deleteMovie(valid)).toEqual({ ok: false, error: DENIED });
    expect(mocks.deleteMovies).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    expect(await deleteMovie(valid)).toEqual({ ok: false, error: DENIED });
    expect(mocks.deleteMovies).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(deleteMovie(valid)).rejects.toThrow("database down");
    expect(mocks.deleteMovies).not.toHaveBeenCalled();
  });
});

describe("deleteMovie input", () => {
  it("refuses an extra key, such as a stray moveFiles", async () => {
    expect(await deleteMovie({ ...valid, moveFiles: true })).toEqual({ ok: false, error: INVALID });
    expect(mocks.deleteMovies).not.toHaveBeenCalled();
  });

  it("refuses a movie id that is not a positive integer", async () => {
    for (const movieId of [0, -1, 1.5, "7"]) {
      expect(await deleteMovie({ ...valid, movieId })).toEqual({ ok: false, error: INVALID });
    }
    expect(mocks.deleteMovies).not.toHaveBeenCalled();
  });

  it("refuses a missing boolean, so a missing choice is never read as no", async () => {
    expect(await deleteMovie({ movieId: 7, addImportExclusion: false })).toEqual({ ok: false, error: INVALID });
    expect(await deleteMovie({ movieId: 7, deleteFiles: false })).toEqual({ ok: false, error: INVALID });
    expect(mocks.deleteMovies).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("deleteMovie success", () => {
  it("sends exactly one movie id with both booleans, and redirects to Home", async () => {
    await expect(deleteMovie({ movieId: 7, deleteFiles: true, addImportExclusion: true })).rejects.toThrow(
      "NEXT_REDIRECT /",
    );

    expect(mocks.deleteMovies).toHaveBeenCalledWith({ movieIds: [7], deleteFiles: true, addImportExclusion: true });
    expect(mocks.redirect).toHaveBeenCalledWith("/", "replace");
  });

  it("does not refresh on success, because it redirects instead", async () => {
    await expect(deleteMovie(valid)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("deleteMovie Radarr failures", () => {
  it("says Radarr may still be deleting after a timeout", async () => {
    mocks.deleteMovies.mockRejectedValue(new ArrRequestError("Radarr movie delete request failed: timed out", "timeout"));

    const result = await deleteMovie(valid);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("may still be deleting");
    expect(result.error).toContain("refreshed");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("says Radarr didn't confirm for any other failure", async () => {
    mocks.deleteMovies.mockRejectedValue(new ArrRequestError("Radarr movie delete request failed: HTTP 504", "http", 504));

    const result = await deleteMovie(valid);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("didn't confirm");
    expect(result.error).toContain("refreshed");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("logs the upstream message", async () => {
    mocks.deleteMovies.mockRejectedValue(new ArrRequestError("Radarr movie delete request failed: HTTP 500", "http", 500));

    await deleteMovie(valid);

    expect(console.error).toHaveBeenCalledWith("Movie delete: Radarr movie delete request failed: HTTP 500");
  });

  it("rethrows errors that are not Radarr request failures", async () => {
    mocks.deleteMovies.mockRejectedValue(new Error("unexpected"));

    await expect(deleteMovie(valid)).rejects.toThrow("unexpected");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

const EDIT_DENIED = "You don't have permission to edit movies.";
const EDIT_INVALID = "Invalid edit.";
const movieEdit = { movieId: 7, monitored: true };
const MOVIE_PROFILES = [
  { id: 1, name: "HD-1080p" },
  { id: 2, name: "Any" },
];

describe("updateMovie authorization", () => {
  it("checks for the admin role only", async () => {
    await updateMovie(movieEdit);

    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("rejects a requester and never calls Radarr or refreshes", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await updateMovie(movieEdit)).toEqual({ ok: false, error: EDIT_DENIED });
    expect(mocks.editMovie).not.toHaveBeenCalled();
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    expect(await updateMovie(movieEdit)).toEqual({ ok: false, error: EDIT_DENIED });
    expect(mocks.editMovie).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(updateMovie(movieEdit)).rejects.toThrow("database down");
    expect(mocks.editMovie).not.toHaveBeenCalled();
  });
});

describe("updateMovie input validation", () => {
  const invalid: [string, unknown][] = [
    ["not an object", "movie"],
    ["null", null],
    ["no movie id", { monitored: true }],
    ["a zero id", { movieId: 0, monitored: true }],
    ["a negative id", { movieId: -1, monitored: true }],
    ["a string id", { movieId: "7", monitored: true }],
    ["a fractional id", { movieId: 7.5, monitored: true }],
    ["an empty edit", { movieId: 7 }],
    ["an unknown key", { movieId: 7, monitored: true, deleteFiles: true }],
    ["a root folder path", { movieId: 7, monitored: true, rootFolderPath: "/invented/movies/" }],
    ["a moveFiles flag", { movieId: 7, monitored: true, moveFiles: true }],
    ["a movieIds list", { movieIds: [7], monitored: true }],
    ["a string profile id", { movieId: 7, qualityProfileId: "2" }],
    ["a zero profile id", { movieId: 7, qualityProfileId: 0 }],
    ["a fractional profile id", { movieId: 7, qualityProfileId: 1.5 }],
    ["a non-boolean monitored", { movieId: 7, monitored: "yes" }],
    ["a minimum availability the form does not offer", { movieId: 7, minimumAvailability: "tba" }],
    ["a deleted minimum availability", { movieId: 7, minimumAvailability: "deleted" }],
    ["a minimum availability with the wrong case", { movieId: 7, minimumAvailability: "Released" }],
    ["a null minimum availability", { movieId: 7, minimumAvailability: null }],
  ];

  it.each(invalid)("rejects %s without calling Radarr", async (_name, input) => {
    expect(await updateMovie(input)).toEqual({ ok: false, error: EDIT_INVALID });
    expect(mocks.editMovie).not.toHaveBeenCalled();
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not put Zod details in the error", async () => {
    const result = await updateMovie({ movieId: -1, monitored: true });
    expect(JSON.stringify(result)).not.toMatch(/Too small|received|issues|path/);
  });
});

describe("updateMovie edits", () => {
  it("sends the id and a monitored flag, without checking profiles", async () => {
    expect(await updateMovie({ movieId: 7, monitored: false })).toEqual({ ok: true });

    expect(mocks.editMovie).toHaveBeenCalledWith({ movieId: 7, monitored: false });
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
  });

  it("checks that a chosen quality profile still exists, then sends it", async () => {
    mocks.listQualityProfiles.mockResolvedValue(MOVIE_PROFILES);

    expect(await updateMovie({ movieId: 7, qualityProfileId: 2 })).toEqual({ ok: true });

    expect(mocks.listQualityProfiles).toHaveBeenCalledTimes(1);
    expect(mocks.editMovie).toHaveBeenCalledWith({ movieId: 7, qualityProfileId: 2 });
  });

  it.each(["announced", "inCinemas", "released"] as const)(
    "sends minimum availability %s alone, without checking profiles",
    async (minimumAvailability) => {
      expect(await updateMovie({ movieId: 7, minimumAvailability })).toEqual({ ok: true });

      expect(mocks.editMovie).toHaveBeenCalledWith({ movieId: 7, minimumAvailability });
      expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
    },
  );

  it("sends every field together, and exactly those fields", async () => {
    mocks.listQualityProfiles.mockResolvedValue(MOVIE_PROFILES);

    await updateMovie({ movieId: 7, qualityProfileId: 1, monitored: true, minimumAvailability: "released" });

    expect(mocks.editMovie).toHaveBeenCalledTimes(1);
    expect(mocks.editMovie.mock.calls[0][0]).toStrictEqual({
      movieId: 7,
      qualityProfileId: 1,
      monitored: true,
      minimumAvailability: "released",
    });
  });

  it("refreshes the page after a successful edit", async () => {
    await updateMovie(movieEdit);

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("refuses a quality profile that no longer exists, without editing, and refreshes so the form gets the current profiles", async () => {
    mocks.listQualityProfiles.mockResolvedValue(MOVIE_PROFILES);

    const result = await updateMovie({ movieId: 7, qualityProfileId: 99 });

    expect(result).toEqual({ ok: false, error: "That quality profile no longer exists." });
    expect(mocks.editMovie).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("gives the friendly error when Radarr rejects the edit, and logs only the safe message", async () => {
    mocks.editMovie.mockRejectedValue(new ArrRequestError("Radarr movie edit request failed: HTTP 500", "http", 500));

    const result = await updateMovie(movieEdit);

    expect(result).toEqual({ ok: false, error: "Radarr didn't accept the change. Try again." });
    expect(console.error).toHaveBeenCalledWith("Movie edit: Radarr movie edit request failed: HTTP 500");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the same friendly error after a timeout", async () => {
    mocks.editMovie.mockRejectedValue(new ArrRequestError("Radarr movie edit request failed: timed out", "timeout"));

    expect(await updateMovie(movieEdit)).toEqual({ ok: false, error: "Radarr didn't accept the change. Try again." });
    expect(console.error).toHaveBeenCalledWith("Movie edit: Radarr movie edit request failed: timed out");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error when the profile list cannot be fetched, and does not edit", async () => {
    mocks.listQualityProfiles.mockRejectedValue(
      new ArrRequestError("Radarr quality profile request failed: timed out", "timeout"),
    );

    const result = await updateMovie({ movieId: 7, qualityProfileId: 1 });

    expect(result).toEqual({ ok: false, error: "Radarr didn't accept the change. Try again." });
    expect(mocks.editMovie).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not Radarr request failures", async () => {
    mocks.editMovie.mockRejectedValue(new Error("config broken"));

    await expect(updateMovie(movieEdit)).rejects.toThrow("config broken");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  deleteMovies: vi.fn(),
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
import { deleteMovie } from "./actions";

const DENIED = "You don't have permission to delete movies.";
const INVALID = "Invalid delete.";
const valid = { movieId: 7, deleteFiles: false, addImportExclusion: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.deleteMovies.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteMovie authorization", () => {
  it("checks for the admin role only", async () => {
    await expect(deleteMovie(valid)).rejects.toThrow("NEXT_REDIRECT /movies");
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
  it("sends exactly one movie id with both booleans, and redirects to the Movies list", async () => {
    await expect(deleteMovie({ movieId: 7, deleteFiles: true, addImportExclusion: true })).rejects.toThrow(
      "NEXT_REDIRECT /movies",
    );

    expect(mocks.deleteMovies).toHaveBeenCalledWith({ movieIds: [7], deleteFiles: true, addImportExclusion: true });
    expect(mocks.redirect).toHaveBeenCalledWith("/movies", "replace");
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

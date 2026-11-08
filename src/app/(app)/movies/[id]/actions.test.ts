import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
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
const EDIT_DENIED = "You don't have permission to edit movies.";
const EDIT_INVALID = "Invalid edit.";
const valid = { movieId: 7, deleteFiles: false, addImportExclusion: false };
const movieEdit = { movieId: 7, monitored: true };
const MOVIE_PROFILES = [
  { id: 1, name: "HD-1080p" },
  { id: 2, name: "Any" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.deleteMovies.mockResolvedValue(undefined);
  mocks.editMovie.mockResolvedValue(undefined);
  mocks.listQualityProfiles.mockResolvedValue(MOVIE_PROFILES);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** deleteMovie succeeds by redirecting, which throws in the mock. Swallow only that, and rethrow anything else. */
async function settle(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT ")) return undefined;
    throw error;
  }
}

describe("authorization", () => {
  type AuthRow = { name: string; call: () => Promise<unknown>; denied: string; upstream: Mock[] };

  // Both actions need the admin role. A 401 and a 403 take the same branch, so one 403 row covers both.
  const rows: AuthRow[] = [
    { name: "deleteMovie", call: () => deleteMovie(valid), denied: DENIED, upstream: [mocks.deleteMovies] },
    { name: "updateMovie", call: () => updateMovie(movieEdit), denied: EDIT_DENIED, upstream: [mocks.editMovie, mocks.listQualityProfiles] },
  ];

  it.each(rows)("$name asks for the admin role", async ({ call }) => {
    await settle(call());
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it.each(rows)("$name refuses a denied caller, and calls no upstream function, refresh or redirect", async ({ call, denied, upstream }) => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await call()).toEqual({ ok: false, error: denied });
    for (const mock of upstream) expect(mock).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(rows)("$name rethrows a non-authorization error, and calls no upstream function", async ({ call, upstream }) => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(call()).rejects.toThrow("database down");
    for (const mock of upstream) expect(mock).not.toHaveBeenCalled();
  });
});

describe("deleteMovie input", () => {
  const invalid: [string, unknown][] = [
    ["an extra key, such as a stray moveFiles", { ...valid, moveFiles: true }],
    ["a zero id", { ...valid, movieId: 0 }],
    ["a negative id", { ...valid, movieId: -1 }],
    ["a fractional id", { ...valid, movieId: 1.5 }],
    ["a string id", { ...valid, movieId: "7" }],
    ["a missing deleteFiles", { movieId: 7, addImportExclusion: false }],
    ["a missing addImportExclusion", { movieId: 7, deleteFiles: false }],
  ];

  it.each(invalid)("rejects %s without calling Radarr or redirecting", async (_name, input) => {
    expect(await deleteMovie(input)).toEqual({ ok: false, error: INVALID });
    expect(mocks.deleteMovies).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("deleteMovie success and Radarr failures", () => {
  it("sends exactly one movie id with both booleans, redirects to Home without refreshing", async () => {
    await settle(deleteMovie({ movieId: 7, deleteFiles: true, addImportExclusion: true }));

    expect(mocks.deleteMovies).toHaveBeenCalledWith({ movieIds: [7], deleteFiles: true, addImportExclusion: true });
    expect(mocks.redirect).toHaveBeenCalledWith("/", "replace");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  // The timeout and the other failures get different messages, so each needs its own row.
  it.each([
    {
      name: "a timeout",
      error: new ArrRequestError("Radarr movie delete request failed: timed out", "timeout"),
      message: "Radarr is taking a long time and may still be deleting. The page has been refreshed; check it before trying again.",
    },
    {
      name: "an HTTP 504",
      error: new ArrRequestError("Radarr movie delete request failed: HTTP 504", "http", 504),
      message: "Radarr didn't confirm the delete, so the movie may already be gone. The page has been refreshed; check it before trying again.",
    },
  ])("says the delete is unconfirmed after $name, logs only the safe message, and refreshes instead of redirecting", async ({ error, message }) => {
    mocks.deleteMovies.mockRejectedValue(error);

    expect(await deleteMovie(valid)).toEqual({ ok: false, error: message });
    expect(console.error).toHaveBeenCalledWith(`Movie delete: ${error.message}`);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
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
  it("sends the id and a monitored flag, without checking profiles, then refreshes", async () => {
    expect(await updateMovie({ movieId: 7, monitored: false })).toEqual({ ok: true });

    expect(mocks.editMovie).toHaveBeenCalledWith({ movieId: 7, monitored: false });
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("checks that a chosen quality profile still exists, then sends it", async () => {
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
    await updateMovie({ movieId: 7, qualityProfileId: 1, monitored: true, minimumAvailability: "released" });

    expect(mocks.editMovie).toHaveBeenCalledTimes(1);
    expect(mocks.editMovie.mock.calls[0][0]).toStrictEqual({
      movieId: 7,
      qualityProfileId: 1,
      monitored: true,
      minimumAvailability: "released",
    });
  });

  it("refuses a quality profile that no longer exists, without editing, and refreshes so the form gets the current profiles", async () => {
    const result = await updateMovie({ movieId: 7, qualityProfileId: 99 });

    expect(result).toEqual({ ok: false, error: "That quality profile no longer exists." });
    expect(mocks.editMovie).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  // Radarr's message is the same for an HTTP error and a timeout, so both rows share one expected result.
  it.each([
    ["an HTTP 500", new ArrRequestError("Radarr movie edit request failed: HTTP 500", "http", 500)],
    ["a timeout", new ArrRequestError("Radarr movie edit request failed: timed out", "timeout")],
  ])("gives the friendly error after %s, logs only the safe message, and does not refresh", async (_name, error) => {
    mocks.editMovie.mockRejectedValue(error);

    expect(await updateMovie(movieEdit)).toEqual({ ok: false, error: "Radarr didn't accept the change. Try again." });
    expect(console.error).toHaveBeenCalledWith(`Movie edit: ${error.message}`);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error when the profile list cannot be fetched, and does not edit", async () => {
    mocks.listQualityProfiles.mockRejectedValue(new ArrRequestError("Radarr quality profile request failed: timed out", "timeout"));

    expect(await updateMovie({ movieId: 7, qualityProfileId: 1 })).toEqual({ ok: false, error: "Radarr didn't accept the change. Try again." });
    expect(mocks.editMovie).not.toHaveBeenCalled();
  });
});

describe("errors that are not Radarr request failures are rethrown", () => {
  const rethrowRows: [string, Mock, () => Promise<unknown>][] = [
    ["deleteMovie", mocks.deleteMovies, () => deleteMovie(valid)],
    ["updateMovie", mocks.editMovie, () => updateMovie(movieEdit)],
  ];

  it.each(rethrowRows)("%s rethrows an error that is not a Radarr request failure, and does not refresh or redirect", async (_name, mock, call) => {
    mock.mockRejectedValue(new Error("unexpected"));

    await expect(call()).rejects.toThrow("unexpected");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

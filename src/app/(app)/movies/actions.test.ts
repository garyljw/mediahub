import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  editMovies: vi.fn(),
  deleteMovies: vi.fn(),
  listQualityProfiles: vi.fn(),
  refresh: vi.fn(),
  lookupMovies: vi.fn(),
  addMovie: vi.fn(),
  searchMovieReleases: vi.fn(),
  refreshMovies: vi.fn(),
  listRootFolders: vi.fn(),
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
  deleteMovies: mocks.deleteMovies,
  listQualityProfiles: mocks.listQualityProfiles,
  searchMovieReleases: mocks.searchMovieReleases,
  refreshMovies: mocks.refreshMovies,
}));

vi.mock("@/server/arr/movie-add", () => {
  class MovieAddError extends Error {
    constructor(readonly reason: "not-found" | "exists") {
      super(reason);
      this.name = "MovieAddError";
    }
  }
  return {
    MovieAddError,
    lookupMovies: mocks.lookupMovies,
    addMovie: mocks.addMovie,
    listRootFolders: mocks.listRootFolders,
  };
});

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import { AuthzError } from "@/server/authz";
import { addLibraryMovie, refreshLibraryMovies, removeMovies, searchLibraryMovies, searchMovies, updateMovies } from "./actions";
import { MovieAddError } from "@/server/arr/movie-add";
import { MAX_REFRESH_MOVIES } from "@/components/movies/movie-refresh";

const DENIED = "You don't have permission to edit movies.";
const DELETE_DENIED = "You don't have permission to delete movies.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.editMovies.mockResolvedValue(undefined);
  mocks.deleteMovies.mockResolvedValue(undefined);
  mocks.searchMovieReleases.mockResolvedValue(undefined);
  mocks.refreshMovies.mockResolvedValue(undefined);
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

describe("removeMovies authorization", () => {
  const input = { movieIds: [1], deleteFiles: false, addImportExclusion: false, confirmCount: 1 };

  it("checks for the admin role", async () => {
    await removeMovies(input);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    const result = await removeMovies(input);

    expect(result).toEqual({ ok: false, error: DELETE_DENIED });
    expect(mocks.deleteMovies).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    const result = await removeMovies(input);

    expect(result).toEqual({ ok: false, error: DELETE_DENIED });
    expect(mocks.deleteMovies).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(removeMovies(input)).rejects.toThrow("database down");
    expect(mocks.deleteMovies).not.toHaveBeenCalled();
  });
});

describe("removeMovies input validation", () => {
  const valid = { movieIds: [1, 2], deleteFiles: false, addImportExclusion: false, confirmCount: 2 };
  const without = (key: string) => {
    const copy: Record<string, unknown> = { ...valid };
    delete copy[key];
    return copy;
  };

  const invalid: [string, unknown][] = [
    ["not an object", "movies"],
    ["null", null],
    ["missing deleteFiles", without("deleteFiles")],
    ["missing addImportExclusion", without("addImportExclusion")],
    ["missing confirmCount", without("confirmCount")],
    ["a string boolean for deleteFiles", { ...valid, deleteFiles: "true" }],
    ["a string boolean for addImportExclusion", { ...valid, addImportExclusion: "false" }],
    ["an extra key moveFiles", { ...valid, moveFiles: true }],
    ["an extra key qualityProfileId", { ...valid, qualityProfileId: 1 }],
    ["empty movieIds", { ...valid, movieIds: [], confirmCount: 0 }],
    ["a negative id", { ...valid, movieIds: [-1, 2] }],
    ["a zero id", { ...valid, movieIds: [0, 2] }],
    ["a string id", { ...valid, movieIds: ["1", 2] }],
    ["a fractional id", { ...valid, movieIds: [1.5, 2] }],
    ["a zero confirmCount", { ...valid, confirmCount: 0 }],
    ["a string confirmCount", { ...valid, confirmCount: "2" }],
    ["more than 2000 ids", { ...valid, movieIds: Array.from({ length: 2001 }, (_, i) => i + 1), confirmCount: 2001 }],
    ["a confirmCount larger than the ids", { ...valid, confirmCount: 3 }],
    ["a confirmCount smaller than the ids", { ...valid, confirmCount: 1 }],
    ["duplicates that make the unique count differ", { ...valid, movieIds: [1, 1, 2], confirmCount: 3 }],
    ["a confirmCount equal to the raw count but not the unique count", { ...valid, movieIds: [1, 1], confirmCount: 2 }],
  ];

  it.each(invalid)("rejects %s without calling Radarr", async (_name, input) => {
    const result = await removeMovies(input);

    expect(result).toEqual({ ok: false, error: "Invalid delete." });
    expect(mocks.deleteMovies).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("accepts exactly 2000 ids", async () => {
    const movieIds = Array.from({ length: 2000 }, (_, i) => i + 1);
    const result = await removeMovies({ movieIds, deleteFiles: true, addImportExclusion: true, confirmCount: 2000 });
    expect(result).toEqual({ ok: true, deleted: 2000 });
    expect(mocks.deleteMovies).toHaveBeenCalledWith({ movieIds, deleteFiles: true, addImportExclusion: true });
  });

  it("does not put Zod details in the error", async () => {
    const result = await removeMovies({ ...valid, moveFiles: true });
    expect(JSON.stringify(result)).not.toMatch(/Unrecognized|received|issues|path/);
  });
});

describe("removeMovies deletes", () => {
  it("de-duplicates ids and checks the count against the unique ids", async () => {
    const result = await removeMovies({ movieIds: [3, 1, 3, 2, 1], deleteFiles: false, addImportExclusion: true, confirmCount: 3 });

    expect(result).toEqual({ ok: true, deleted: 3 });
    expect(mocks.deleteMovies).toHaveBeenCalledWith({ movieIds: [3, 1, 2], deleteFiles: false, addImportExclusion: true });
  });

  it("on success calls deleteMovies with exactly the validated fields, then refreshes", async () => {
    const result = await removeMovies({ movieIds: [5, 6], deleteFiles: true, addImportExclusion: false, confirmCount: 2 });

    expect(result).toEqual({ ok: true, deleted: 2 });
    expect(mocks.deleteMovies).toHaveBeenCalledTimes(1);
    expect(mocks.deleteMovies.mock.calls[0][0]).toStrictEqual({ movieIds: [5, 6], deleteFiles: true, addImportExclusion: false });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("never edits, only deletes", async () => {
    await removeMovies({ movieIds: [1], deleteFiles: false, addImportExclusion: false, confirmCount: 1 });
    expect(mocks.editMovies).not.toHaveBeenCalled();
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
  });

  it("gives the friendly error when Radarr rejects the delete, and logs only the safe message", async () => {
    mocks.deleteMovies.mockRejectedValue(new ArrRequestError("Radarr movie delete request failed: HTTP 500"));

    const result = await removeMovies({ movieIds: [1], deleteFiles: false, addImportExclusion: false, confirmCount: 1 });

    expect(result).toEqual({
      ok: false,
      error: "Radarr didn't confirm the delete, so some movies may already be gone. The table has been refreshed; check it before trying again.",
    });
    expect(console.error).toHaveBeenCalledWith("Movie delete: Radarr movie delete request failed: HTTP 500");
    // Radarr may have deleted some anyway, so the table is re-read even on failure.
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("says a timed-out delete may still be running, and refreshes", async () => {
    mocks.deleteMovies.mockRejectedValue(new ArrRequestError("Radarr movie delete request failed: timed out", "timeout"));

    const result = await removeMovies({ movieIds: [1], deleteFiles: true, addImportExclusion: false, confirmCount: 1 });

    expect(result).toEqual({
      ok: false,
      error: "Radarr is taking a long time and may still be deleting. The table has been refreshed; check it before trying again.",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("rethrows errors that are not Radarr request failures", async () => {
    mocks.deleteMovies.mockRejectedValue(new Error("config broken"));
    await expect(removeMovies({ movieIds: [1], deleteFiles: false, addImportExclusion: false, confirmCount: 1 })).rejects.toThrow(
      "config broken",
    );
  });
});

const ADDER = { id: "u1", email: "a@example.test", name: "A", role: "requester" };
const ADD_DENIED = "You don't have permission to add movies.";
const validAdd = { tmdbId: 910001, qualityProfileId: 1, rootFolderId: 7, monitored: true, searchForMovie: true };

describe("searchMovies", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADDER });
    mocks.lookupMovies.mockResolvedValue([{ tmdbId: 1, title: "Film", year: 2000, overview: "", inLibrary: false }]);
  });

  it("allows both admin and requester", async () => {
    await searchMovies({ term: "film" });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
  });

  it("rejects a signed-out caller and never calls Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));
    const result = await searchMovies({ term: "film" });
    expect(result).toEqual({ ok: false, error: ADD_DENIED });
    expect(mocks.lookupMovies).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty term", { term: "" }],
    ["a whitespace-only term", { term: "   " }],
    ["an overlong term", { term: "x".repeat(101) }],
    ["an extra key", { term: "film", page: 2 }],
    ["a missing term", {}],
    ["a non-string term", { term: 5 }],
  ])("rejects %s without calling Radarr", async (_name, input) => {
    const result = await searchMovies(input);
    expect(result.ok).toBe(false);
    expect(mocks.lookupMovies).not.toHaveBeenCalled();
  });

  it("trims the term and accepts exactly 100 characters", async () => {
    await searchMovies({ term: `  ${"x".repeat(100)}  ` });
    expect(mocks.lookupMovies).toHaveBeenCalledWith("x".repeat(100));
  });

  it("returns the results on success", async () => {
    const result = await searchMovies({ term: "film" });
    expect(result).toEqual({ ok: true, results: [{ tmdbId: 1, title: "Film", year: 2000, overview: "", inLibrary: false }] });
  });

  it("gives a friendly error and logs only the safe message when Radarr fails", async () => {
    mocks.lookupMovies.mockRejectedValue(new ArrRequestError("Radarr movie lookup request failed: HTTP 500"));
    const result = await searchMovies({ term: "film" });
    expect(result).toEqual({ ok: false, error: "Radarr couldn't complete the search. Try again." });
    expect(console.error).toHaveBeenCalledWith("Movie search: Radarr movie lookup request failed: HTTP 500");
  });

  it("rethrows errors that are not Radarr request failures", async () => {
    mocks.lookupMovies.mockRejectedValue(new Error("config broken"));
    await expect(searchMovies({ term: "film" })).rejects.toThrow("config broken");
  });
});

describe("addLibraryMovie authorization", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADDER });
    mocks.listRootFolders.mockResolvedValue([{ id: 7, path: "/invented/movies/", freeSpace: 1 }]);
    mocks.addMovie.mockResolvedValue({ title: "Lantern Harbour", year: 2021 });
  });

  it("allows both admin and requester", async () => {
    await addLibraryMovie(validAdd);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
  });

  it("rejects a signed-out caller (401) without calling Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));
    const result = await addLibraryMovie(validAdd);
    expect(result).toEqual({ ok: false, error: ADD_DENIED });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.listRootFolders).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));
    await expect(addLibraryMovie(validAdd)).rejects.toThrow("database down");
    expect(mocks.addMovie).not.toHaveBeenCalled();
  });
});

describe("addLibraryMovie input validation", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADDER });
  });

  const without = (key: string) => {
    const copy: Record<string, unknown> = { ...validAdd };
    delete copy[key];
    return copy;
  };

  const invalid: [string, unknown][] = [
    ["not an object", "movie"],
    ["null", null],
    ["a missing tmdbId", without("tmdbId")],
    ["a missing qualityProfileId", without("qualityProfileId")],
    ["a missing rootFolderId", without("rootFolderId")],
    ["a missing monitored", without("monitored")],
    ["a missing searchForMovie", without("searchForMovie")],
    ["a string boolean for monitored", { ...validAdd, monitored: "true" }],
    ["a string boolean for searchForMovie", { ...validAdd, searchForMovie: "false" }],
    ["a zero tmdbId", { ...validAdd, tmdbId: 0 }],
    ["a fractional tmdbId", { ...validAdd, tmdbId: 1.5 }],
    ["a string tmdbId", { ...validAdd, tmdbId: "910001" }],
    ["a negative profile id", { ...validAdd, qualityProfileId: -1 }],
    ["a zero root folder id", { ...validAdd, rootFolderId: 0 }],
    ["a string root folder id", { ...validAdd, rootFolderId: "7" }],
    ["a rootFolderPath key", { ...validAdd, rootFolderPath: "/invented/movies/" }],
    ["a title key", { ...validAdd, title: "Chosen Title" }],
    ["a string rootFolderPath instead of an id", { tmdbId: 910001, qualityProfileId: 1, rootFolderPath: "/invented/movies/", monitored: true, searchForMovie: true }],
  ];

  it.each(invalid)("rejects %s without calling Radarr", async (_name, input) => {
    const result = await addLibraryMovie(input);
    expect(result).toEqual({ ok: false, error: "Invalid add." });
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.listRootFolders).not.toHaveBeenCalled();
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("addLibraryMovie resolution and results", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADDER });
    mocks.listQualityProfiles.mockResolvedValue([{ id: 1, name: "HD-1080p" }]);
    mocks.listRootFolders.mockResolvedValue([
      { id: 7, path: "/invented/movies/", freeSpace: 1 },
      { id: 8, path: "/invented/other/", freeSpace: 2 },
    ]);
    mocks.addMovie.mockResolvedValue({ title: "Lantern Harbour", year: 2021 });
  });

  it("refuses an unknown quality profile without adding", async () => {
    const result = await addLibraryMovie({ ...validAdd, qualityProfileId: 99 });
    expect(result).toEqual({ ok: false, error: "That quality profile no longer exists." });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refuses an unknown root folder id without adding", async () => {
    const result = await addLibraryMovie({ ...validAdd, rootFolderId: 99 });
    expect(result).toEqual({ ok: false, error: "That root folder no longer exists." });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("passes the resolved root folder path, not the id, to addMovie", async () => {
    await addLibraryMovie({ ...validAdd, rootFolderId: 8, monitored: false, searchForMovie: false });
    expect(mocks.addMovie).toHaveBeenCalledWith({
      tmdbId: 910001,
      qualityProfileId: 1,
      rootFolderPath: "/invented/other/",
      monitored: false,
      searchForMovie: false,
    });
  });

  it("returns the title and year from addMovie, then refreshes", async () => {
    const result = await addLibraryMovie(validAdd);
    expect(result).toEqual({ ok: true, title: "Lantern Harbour", year: 2021 });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("maps an exists error to the library message and does not refresh", async () => {
    mocks.addMovie.mockRejectedValue(new MovieAddError("exists"));
    const result = await addLibraryMovie(validAdd);
    expect(result).toEqual({ ok: false, error: "That movie is already in your library." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("maps a not-found error to the Radarr message and does not refresh", async () => {
    mocks.addMovie.mockRejectedValue(new MovieAddError("not-found"));
    const result = await addLibraryMovie(validAdd);
    expect(result).toEqual({ ok: false, error: "Radarr couldn't find that movie." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error and logs the safe message when Radarr fails", async () => {
    mocks.addMovie.mockRejectedValue(new ArrRequestError("Radarr movie add request failed: HTTP 500"));
    const result = await addLibraryMovie(validAdd);
    expect(result).toEqual({ ok: false, error: "Radarr didn't accept the movie. Try again." });
    expect(console.error).toHaveBeenCalledWith("Movie add: Radarr movie add request failed: HTTP 500");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error when the root folder list cannot be fetched", async () => {
    mocks.listRootFolders.mockRejectedValue(new ArrRequestError("Radarr root folder request failed: timed out", "timeout"));
    const result = await addLibraryMovie(validAdd);
    expect(result).toEqual({ ok: false, error: "Radarr didn't accept the movie. Try again." });
    expect(mocks.addMovie).not.toHaveBeenCalled();
  });

  it("says the movie may still have been added when the add times out, and logs the safe message", async () => {
    mocks.addMovie.mockRejectedValue(new ArrRequestError("Radarr movie add request failed: timed out", "timeout"));
    const result = await addLibraryMovie(validAdd);
    expect(result).toEqual({
      ok: false,
      error: "Radarr took too long to answer. The movie may still have been added, so reload the page to check.",
    });
    expect(console.error).toHaveBeenCalledWith("Movie add: Radarr movie add request failed: timed out");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not claim the movie may have been added when only the root folder read timed out", async () => {
    mocks.listRootFolders.mockRejectedValue(new ArrRequestError("Radarr root folder request failed: timed out", "timeout"));
    const result = await addLibraryMovie(validAdd);
    expect(result).toEqual({ ok: false, error: "Radarr didn't accept the movie. Try again." });
    expect(mocks.addMovie).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not Radarr request failures", async () => {
    mocks.addMovie.mockRejectedValue(new Error("config broken"));
    await expect(addLibraryMovie(validAdd)).rejects.toThrow("config broken");
  });
});

describe("searchLibraryMovies", () => {
  const SEARCH_DENIED = "You don't have permission to search for movies.";

  it("allows both admin and requester", async () => {
    await searchLibraryMovies({ movieIds: [1] });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
  });

  it("rejects a signed-out caller and never calls Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));
    const result = await searchLibraryMovies({ movieIds: [1] });
    expect(result).toEqual({ ok: false, error: SEARCH_DENIED });
    expect(mocks.searchMovieReleases).not.toHaveBeenCalled();
  });

  it("rethrows a non-authorization failure from the role check", async () => {
    mocks.requireRole.mockRejectedValue(new Error("db down"));
    await expect(searchLibraryMovies({ movieIds: [1] })).rejects.toThrow("db down");
    expect(mocks.searchMovieReleases).not.toHaveBeenCalled();
  });

  it.each([
    ["no ids", { movieIds: [] }],
    ["too many ids", { movieIds: Array.from({ length: 101 }, (_, i) => i + 1) }],
    ["a zero id", { movieIds: [0] }],
    ["a fractional id", { movieIds: [1.5] }],
    ["a string id", { movieIds: ["1"] }],
    ["an extra key", { movieIds: [1], monitored: true }],
    ["a missing list", {}],
    ["null", null],
  ])("rejects %s without calling Radarr", async (_name, input) => {
    const result = await searchLibraryMovies(input);
    expect(result).toEqual({ ok: false, error: "Invalid search." });
    expect(mocks.searchMovieReleases).not.toHaveBeenCalled();
  });

  it("accepts exactly 100 ids", async () => {
    const result = await searchLibraryMovies({ movieIds: Array.from({ length: 100 }, (_, i) => i + 1) });
    expect(result).toEqual({ ok: true, searched: 100 });
  });

  it("sends each id once and reports the unique count", async () => {
    const result = await searchLibraryMovies({ movieIds: [4, 5, 4] });
    expect(mocks.searchMovieReleases).toHaveBeenCalledWith([4, 5]);
    expect(result).toEqual({ ok: true, searched: 2 });
  });

  it("gives a friendly error and logs only the safe message when Radarr fails", async () => {
    mocks.searchMovieReleases.mockRejectedValue(new ArrRequestError("Radarr movie search command request failed: HTTP 500"));
    const result = await searchLibraryMovies({ movieIds: [1] });
    expect(result).toEqual({ ok: false, error: "Radarr didn't start the search. Try again." });
    expect(console.error).toHaveBeenCalledWith("Movie search now: Radarr movie search command request failed: HTTP 500");
  });

  it("warns that the search may have started after a timeout", async () => {
    mocks.searchMovieReleases.mockRejectedValue(new ArrRequestError("timed out", "timeout"));
    const result = await searchLibraryMovies({ movieIds: [1] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("may still have started");
  });

  it("rethrows errors that are not Radarr request failures", async () => {
    mocks.searchMovieReleases.mockRejectedValue(new Error("config broken"));
    await expect(searchLibraryMovies({ movieIds: [1] })).rejects.toThrow("config broken");
  });
});

describe("refreshLibraryMovies", () => {
  const REFRESH_DENIED = "You don't have permission to refresh movies.";

  it("checks for the admin role only", async () => {
    await refreshLibraryMovies({ movieIds: [1] });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));
    const result = await refreshLibraryMovies({ movieIds: [1] });
    expect(result).toEqual({ ok: false, error: REFRESH_DENIED });
    expect(mocks.refreshMovies).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Radarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));
    const result = await refreshLibraryMovies({ movieIds: [1] });
    expect(result).toEqual({ ok: false, error: REFRESH_DENIED });
    expect(mocks.refreshMovies).not.toHaveBeenCalled();
  });

  it("rethrows a non-authorization failure from the role check", async () => {
    mocks.requireRole.mockRejectedValue(new Error("db down"));
    await expect(refreshLibraryMovies({ movieIds: [1] })).rejects.toThrow("db down");
    expect(mocks.refreshMovies).not.toHaveBeenCalled();
  });

  it.each([
    ["no ids", { movieIds: [] }],
    ["too many ids", { movieIds: Array.from({ length: MAX_REFRESH_MOVIES + 1 }, (_, i) => i + 1) }],
    ["a zero id", { movieIds: [0] }],
    ["a fractional id", { movieIds: [1.5] }],
    ["a string id", { movieIds: ["1"] }],
    ["an extra key", { movieIds: [1], monitored: true }],
    ["a missing list", {}],
    ["null", null],
  ])("rejects %s without calling Radarr", async (_name, input) => {
    const result = await refreshLibraryMovies(input);
    expect(result).toEqual({ ok: false, error: "Invalid refresh." });
    expect(mocks.refreshMovies).not.toHaveBeenCalled();
  });

  it("accepts exactly MAX_REFRESH_MOVIES ids", async () => {
    const ids = Array.from({ length: MAX_REFRESH_MOVIES }, (_, i) => i + 1);
    const result = await refreshLibraryMovies({ movieIds: ids });
    expect(result).toEqual({ ok: true, refreshed: MAX_REFRESH_MOVIES });
  });

  it("sends each id once and reports the unique count", async () => {
    const result = await refreshLibraryMovies({ movieIds: [4, 5, 4] });
    expect(mocks.refreshMovies).toHaveBeenCalledWith([4, 5]);
    expect(result).toEqual({ ok: true, refreshed: 2 });
  });

  it("does not re-render the page, since Radarr only queues the refresh", async () => {
    await refreshLibraryMovies({ movieIds: [1] });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives a friendly error and logs only the safe message when Radarr fails", async () => {
    mocks.refreshMovies.mockRejectedValue(new ArrRequestError("Radarr movie refresh command request failed: HTTP 500"));
    const result = await refreshLibraryMovies({ movieIds: [1] });
    expect(result).toEqual({ ok: false, error: "Radarr didn't start the refresh. Try again." });
    expect(console.error).toHaveBeenCalledWith("Movie refresh: Radarr movie refresh command request failed: HTTP 500");
  });

  it("warns that the refresh may have started after a timeout", async () => {
    mocks.refreshMovies.mockRejectedValue(new ArrRequestError("timed out", "timeout"));
    const result = await refreshLibraryMovies({ movieIds: [1] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("may still have started");
  });

  it("rethrows errors that are not Radarr request failures", async () => {
    mocks.refreshMovies.mockRejectedValue(new Error("config broken"));
    await expect(refreshLibraryMovies({ movieIds: [1] })).rejects.toThrow("config broken");
  });
});

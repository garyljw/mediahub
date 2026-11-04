import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listQualityProfiles: vi.fn(),
  refresh: vi.fn(),
  lookupMovies: vi.fn(),
  addMovie: vi.fn(),
  searchMovieReleases: vi.fn(),
  refreshMovies: vi.fn(),
  listRootFolders: vi.fn(),
  getMovieAddDefaults: vi.fn(),
  searchReleases: vi.fn(),
  grabRelease: vi.fn(),
}));

vi.mock("@/server/settings/add-defaults", () => ({ getMovieAddDefaults: mocks.getMovieAddDefaults }));

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
  listQualityProfiles: mocks.listQualityProfiles,
  searchMovieReleases: mocks.searchMovieReleases,
  refreshMovies: mocks.refreshMovies,
}));

// grabWasRefused is the real one, so these tests check the same 4xx/5xx rule that decides whether a token is restored.
vi.mock("@/server/arr/releases", async () => {
  const { grabWasRefused } = await vi.importActual<typeof import("@/server/arr/releases")>("@/server/arr/releases");
  class ReleaseGrabError extends Error {
    constructor(readonly reason: "expired") {
      super(reason);
      this.name = "ReleaseGrabError";
    }
  }
  return { ReleaseGrabError, grabWasRefused, searchReleases: mocks.searchReleases, grabRelease: mocks.grabRelease };
});

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
import {
  addLibraryMovie,
  findMovieReleases,
  grabMovieRelease,
  refreshLibraryMovies,
  searchLibraryMovies,
  searchMovies,
} from "./actions";
import { ReleaseGrabError } from "@/server/arr/releases";
import { MovieAddError } from "@/server/arr/movie-add";
import { MAX_REFRESH_MOVIES } from "@/components/movies/movie-refresh";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.searchMovieReleases.mockResolvedValue(undefined);
  mocks.refreshMovies.mockResolvedValue(undefined);
  mocks.searchReleases.mockResolvedValue({ rows: [], totals: { all: 0, usenet: 0, torrent: 0 } });
  mocks.grabRelease.mockResolvedValue({ title: "Starfall.2019.1080p" });
  mocks.listQualityProfiles.mockResolvedValue([
    { id: 1, name: "HD-1080p" },
    { id: 2, name: "Any" },
  ]);
  mocks.getMovieAddDefaults.mockReturnValue({ profileId: null, rootFolderId: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const ADDER = { id: "u1", email: "a@example.test", name: "A", role: "requester" };
const ADMIN = { id: "u1", email: "a@example.test", name: "A", role: "admin" };
const ADD_DENIED = "You don't have permission to add movies.";
const validAdd = { tmdbId: 910001 };

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
    mocks.addMovie.mockResolvedValue({ id: 42, title: "Lantern Harbour", year: 2021 });
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

describe("addLibraryMovie requester input", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADDER });
  });

  // A requester sends only the TMDB id. Any other key is refused before Radarr is read.
  it.each([
    ["not an object", "movie"],
    ["null", null],
    ["a missing tmdbId", {}],
    ["a zero tmdbId", { tmdbId: 0 }],
    ["a fractional tmdbId", { tmdbId: 1.5 }],
    ["a string tmdbId", { tmdbId: "910001" }],
    ["a qualityProfileId", { ...validAdd, qualityProfileId: 1 }],
    ["a rootFolderId", { ...validAdd, rootFolderId: 7 }],
    ["a monitored flag", { ...validAdd, monitored: false }],
    ["a searchForMovie flag", { ...validAdd, searchForMovie: false }],
    ["a rootFolderPath", { ...validAdd, rootFolderPath: "/invented/movies/" }],
    ["a title", { ...validAdd, title: "Chosen Title" }],
  ])("refuses %s with Invalid add. and never calls Radarr", async (_name, input) => {
    expect(await addLibraryMovie(input)).toEqual({ ok: false, error: "Invalid add." });
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.listRootFolders).not.toHaveBeenCalled();
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("addLibraryMovie admin input", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADMIN });
  });

  // Every field the panel shows is required. Each one missing, or any extra key, is refused.
  const full = { tmdbId: 910001, qualityProfileId: 1, rootFolderId: 7, monitored: true, searchForMovie: true };
  const without = (key: string) => {
    const copy: Record<string, unknown> = { ...full };
    delete copy[key];
    return copy;
  };

  it.each([
    ["a missing tmdbId", without("tmdbId")],
    ["a missing qualityProfileId", without("qualityProfileId")],
    ["a missing rootFolderId", without("rootFolderId")],
    ["a missing monitored", without("monitored")],
    ["a missing searchForMovie", without("searchForMovie")],
    ["a string profile id", { ...full, qualityProfileId: "1" }],
    ["a zero root folder id", { ...full, rootFolderId: 0 }],
    ["a string monitored", { ...full, monitored: "true" }],
    ["a rootFolderPath", { ...full, rootFolderPath: "/invented/movies/" }],
    ["a title", { ...full, title: "Chosen Title" }],
    ["null", null],
  ])("refuses %s with Invalid add. and never calls Radarr", async (_name, input) => {
    expect(await addLibraryMovie(input)).toEqual({ ok: false, error: "Invalid add." });
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.addMovie).not.toHaveBeenCalled();
  });
});

describe("addLibraryMovie for a requester", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADDER });
    mocks.listRootFolders.mockResolvedValue([
      { id: 7, path: "/invented/movies/", freeSpace: 1 },
      { id: 8, path: "/invented/other/", freeSpace: 2 },
    ]);
    mocks.addMovie.mockResolvedValue({ id: 42, title: "Lantern Harbour", year: 2021 });
  });

  it("adds with the saved profile and folder, monitored, with search on", async () => {
    mocks.getMovieAddDefaults.mockReturnValue({ profileId: 2, rootFolderId: 8 });

    await addLibraryMovie(validAdd);

    expect(mocks.addMovie).toHaveBeenCalledWith(
      { tmdbId: 910001, qualityProfileId: 2, rootFolderPath: "/invented/other/", monitored: true, searchForMovie: true },
      expect.any(Function),
    );
  });

  it("falls back to the first profile and folder when the saved ids are stale", async () => {
    mocks.getMovieAddDefaults.mockReturnValue({ profileId: 99, rootFolderId: 99 });

    await addLibraryMovie(validAdd);

    expect(mocks.addMovie).toHaveBeenCalledWith(
      { tmdbId: 910001, qualityProfileId: 1, rootFolderPath: "/invented/movies/", monitored: true, searchForMovie: true },
      expect.any(Function),
    );
  });

  it("returns the new id, title and year, then refreshes", async () => {
    expect(await addLibraryMovie(validAdd)).toEqual({ ok: true, id: 42, title: "Lantern Harbour", year: 2021 });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("refuses when Radarr has no root folders, without adding", async () => {
    mocks.listRootFolders.mockResolvedValue([]);
    expect(await addLibraryMovie(validAdd)).toEqual({
      ok: false,
      error: "Radarr has no root folders set up, so movies can't be added yet.",
    });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refuses when Radarr has no quality profiles, without adding", async () => {
    mocks.listQualityProfiles.mockResolvedValue([]);
    expect(await addLibraryMovie(validAdd)).toEqual({
      ok: false,
      error: "Radarr has no quality profiles set up, so movies can't be added yet.",
    });
    expect(mocks.addMovie).not.toHaveBeenCalled();
  });

  it("maps an exists error to the library message and does not refresh", async () => {
    mocks.addMovie.mockRejectedValue(new MovieAddError("exists"));
    expect(await addLibraryMovie(validAdd)).toEqual({ ok: false, error: "That movie is already in your library." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("maps a not-found error to the Radarr message and does not refresh", async () => {
    mocks.addMovie.mockRejectedValue(new MovieAddError("not-found"));
    expect(await addLibraryMovie(validAdd)).toEqual({ ok: false, error: "Radarr couldn't find that movie." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error and logs the safe message when Radarr fails", async () => {
    mocks.addMovie.mockRejectedValue(new ArrRequestError("Radarr movie add request failed: HTTP 500"));
    expect(await addLibraryMovie(validAdd)).toEqual({ ok: false, error: "Radarr didn't accept the movie. Try again." });
    expect(console.error).toHaveBeenCalledWith("Movie add: Radarr movie add request failed: HTTP 500");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error when the root folder list cannot be fetched", async () => {
    mocks.listRootFolders.mockRejectedValue(new ArrRequestError("Radarr root folder request failed: timed out", "timeout"));
    expect(await addLibraryMovie(validAdd)).toEqual({ ok: false, error: "Radarr didn't accept the movie. Try again." });
    expect(mocks.addMovie).not.toHaveBeenCalled();
  });

  it("says the movie may still have been added when the add times out, and logs the safe message", async () => {
    mocks.addMovie.mockImplementation(async (_add: unknown, onSend: () => void) => {
      onSend();
      throw new ArrRequestError("Radarr movie add request failed: timed out", "timeout");
    });
    expect(await addLibraryMovie(validAdd)).toEqual({
      ok: false,
      error: "Radarr took too long to answer. The movie may still have been added, so reload the page to check.",
    });
    expect(console.error).toHaveBeenCalledWith("Movie add: Radarr movie add request failed: timed out");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not claim the movie may have been added when the lookup before the add timed out", async () => {
    mocks.addMovie.mockRejectedValue(new ArrRequestError("Radarr movie lookup request failed: timed out", "timeout"));
    expect(await addLibraryMovie(validAdd)).toEqual({ ok: false, error: "Radarr didn't accept the movie. Try again." });
  });

  it("does not claim the movie may have been added when only the root folder read timed out", async () => {
    mocks.listRootFolders.mockRejectedValue(new ArrRequestError("Radarr root folder request failed: timed out", "timeout"));
    expect(await addLibraryMovie(validAdd)).toEqual({ ok: false, error: "Radarr didn't accept the movie. Try again." });
    expect(mocks.addMovie).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not Radarr request failures", async () => {
    mocks.addMovie.mockRejectedValue(new Error("config broken"));
    await expect(addLibraryMovie(validAdd)).rejects.toThrow("config broken");
  });
});

describe("addLibraryMovie for an admin", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADMIN });
    mocks.listRootFolders.mockResolvedValue([
      { id: 7, path: "/invented/movies/", freeSpace: 1 },
      { id: 8, path: "/invented/other/", freeSpace: 2 },
    ]);
    mocks.addMovie.mockResolvedValue({ id: 43, title: "Lantern Harbour", year: 2021 });
  });

  const chosen = { tmdbId: 910001, qualityProfileId: 1, rootFolderId: 8, monitored: false, searchForMovie: false };

  it("adds with the chosen profile, folder, monitored and search values", async () => {
    mocks.getMovieAddDefaults.mockReturnValue({ profileId: 2, rootFolderId: 7 });
    expect(await addLibraryMovie(chosen)).toEqual({ ok: true, id: 43, title: "Lantern Harbour", year: 2021 });
    expect(mocks.addMovie.mock.calls[0][0]).toStrictEqual({
      tmdbId: 910001,
      qualityProfileId: 1,
      rootFolderPath: "/invented/other/",
      monitored: false,
      searchForMovie: false,
    });
  });

  it("does not use the saved defaults when the admin sends choices", async () => {
    mocks.getMovieAddDefaults.mockReturnValue({ profileId: 2, rootFolderId: 7 });
    await addLibraryMovie({ ...chosen, qualityProfileId: 1, rootFolderId: 7 });
    expect(mocks.addMovie.mock.calls[0][0]).toMatchObject({ qualityProfileId: 1, rootFolderPath: "/invented/movies/" });
  });

  it("refuses an unknown quality profile without adding", async () => {
    expect(await addLibraryMovie({ ...chosen, qualityProfileId: 99 })).toEqual({
      ok: false,
      error: "That quality profile no longer exists.",
    });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refuses an unknown root folder without adding", async () => {
    expect(await addLibraryMovie({ ...chosen, rootFolderId: 99 })).toEqual({
      ok: false,
      error: "That root folder no longer exists.",
    });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refuses when Radarr has no root folders, without adding", async () => {
    mocks.listRootFolders.mockResolvedValue([]);
    expect(await addLibraryMovie(chosen)).toEqual({ ok: false, error: "That root folder no longer exists." });
    expect(mocks.addMovie).not.toHaveBeenCalled();
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

describe("findMovieReleases and grabMovieRelease", () => {
  const PICK_DENIED = "You don't have permission to pick releases.";
  const release = { token: "00000000-0000-4000-8000-000000000001", title: "Starfall.2019.1080p" };

  describe("authorization", () => {
    it.each([
      ["findMovieReleases", () => findMovieReleases({ movieId: 1 })],
      ["grabMovieRelease", () => grabMovieRelease({ token: release.token })],
    ])("checks for the admin role only in %s", async (_name, call) => {
      await call();
      expect(mocks.requireRole).toHaveBeenCalledWith("admin");
    });

    it.each([
      ["requester (403)", 403],
      ["signed-out (401)", 401],
    ] as const)("rejects a %s and never calls Radarr", async (_label, status) => {
      mocks.requireRole.mockRejectedValue(new AuthzError(status));

      expect(await findMovieReleases({ movieId: 1 })).toEqual({ ok: false, error: PICK_DENIED });
      expect(await grabMovieRelease({ token: release.token })).toEqual({ ok: false, error: PICK_DENIED });
      expect(mocks.searchReleases).not.toHaveBeenCalled();
      expect(mocks.grabRelease).not.toHaveBeenCalled();
    });

    it("rethrows errors that are not authorization failures", async () => {
      mocks.requireRole.mockRejectedValue(new Error("database down"));
      await expect(findMovieReleases({ movieId: 1 })).rejects.toThrow("database down");
      await expect(grabMovieRelease({ token: release.token })).rejects.toThrow("database down");
      expect(mocks.searchReleases).not.toHaveBeenCalled();
      expect(mocks.grabRelease).not.toHaveBeenCalled();
    });
  });

  describe("findMovieReleases input and results", () => {
    it.each([
      ["a missing id", {}],
      ["a zero id", { movieId: 0 }],
      ["a negative id", { movieId: -3 }],
      ["a fractional id", { movieId: 1.5 }],
      ["a string id", { movieId: "1" }],
      ["an extra key", { movieId: 1, indexerId: 2 }],
      ["null", null],
    ])("rejects %s without calling Radarr", async (_name, input) => {
      expect(await findMovieReleases(input)).toEqual({ ok: false, error: "Invalid search." });
      expect(mocks.searchReleases).not.toHaveBeenCalled();
    });

    it("returns the rows and totals on success, and does not re-render the page", async () => {
      const rows = [{ token: release.token, title: release.title }];
      const totals = { all: 9, usenet: 5, torrent: 4 };
      mocks.searchReleases.mockResolvedValue({ rows, totals });

      const result = await findMovieReleases({ movieId: 7 });

      expect(mocks.searchReleases).toHaveBeenCalledWith(7);
      expect(result).toEqual({ ok: true, releases: rows, totals });
      expect(mocks.refresh).not.toHaveBeenCalled();
    });

    it("says it timed out, and logs only the safe message", async () => {
      mocks.searchReleases.mockRejectedValue(new ArrRequestError("Radarr release search request failed: timed out", "timeout"));
      const result = await findMovieReleases({ movieId: 1 });
      expect(result).toEqual({ ok: false, error: "Radarr took too long searching the indexers. Try again in a moment." });
      expect(console.error).toHaveBeenCalledWith("Release search: Radarr release search request failed: timed out");
    });

    it("says the movie is gone on a 404", async () => {
      mocks.searchReleases.mockRejectedValue(new ArrRequestError("Radarr release search request failed: HTTP 404", "http", 404));
      expect(await findMovieReleases({ movieId: 1 })).toEqual({
        ok: false,
        error: "That movie is no longer in Radarr. Close this and reload the page.",
      });
    });

    it("gives the generic message for other Radarr failures", async () => {
      mocks.searchReleases.mockRejectedValue(new ArrRequestError("Radarr release search request failed: HTTP 500", "http", 500));
      expect(await findMovieReleases({ movieId: 1 })).toEqual({
        ok: false,
        error: "Radarr couldn't search the indexers. Try again.",
      });
    });

    it("rethrows errors that are not Radarr request failures", async () => {
      mocks.searchReleases.mockRejectedValue(new Error("config broken"));
      await expect(findMovieReleases({ movieId: 1 })).rejects.toThrow("config broken");
    });
  });

  describe("grabMovieRelease input and results", () => {
    it.each([
      ["a missing token", {}],
      ["a token that is not a UUID", { token: "not-a-uuid" }],
      ["a number token", { token: 12 }],
      ["an extra key", { token: release.token, guid: "https://indexer.test/details/1" }],
      ["null", null],
    ])("rejects %s without calling Radarr", async (_name, input) => {
      expect(await grabMovieRelease(input)).toEqual({ ok: false, error: "Invalid grab." });
      expect(mocks.grabRelease).not.toHaveBeenCalled();
    });

    it("returns the title on success, and does not re-render the page", async () => {
      mocks.grabRelease.mockResolvedValue({ title: release.title });

      const result = await grabMovieRelease({ token: release.token });

      expect(mocks.grabRelease).toHaveBeenCalledWith(release.token);
      expect(result).toEqual({ ok: true, title: release.title });
      expect(mocks.refresh).not.toHaveBeenCalled();
    });

    it("says the result expired when the token is unknown or used up", async () => {
      mocks.grabRelease.mockRejectedValue(new ReleaseGrabError("expired"));
      expect(await grabMovieRelease({ token: release.token })).toEqual({
        ok: false,
        error: "That result has expired. Search again.",
      });
    });

    it("warns about a possible grab after a timeout", async () => {
      mocks.grabRelease.mockRejectedValue(new ArrRequestError("Radarr release grab request failed: timed out", "timeout"));
      expect(await grabMovieRelease({ token: release.token })).toEqual({
        ok: false,
        error: "Radarr took too long to answer. The release may still have been grabbed, so check the queue before trying again.",
      });
      expect(console.error).toHaveBeenCalledWith("Release grab: Radarr release grab request failed: timed out");
    });

    it("says the indexer did not hand over the release on a 409", async () => {
      mocks.grabRelease.mockRejectedValue(new ArrRequestError("Radarr release grab request failed: HTTP 409", "http", 409));
      expect(await grabMovieRelease({ token: release.token })).toEqual({
        ok: false,
        error: "The indexer didn't hand over that release. Try again, or pick another one.",
      });
    });

    it("gives the plain refusal message for other 4xx errors", async () => {
      mocks.grabRelease.mockRejectedValue(new ArrRequestError("Radarr release grab request failed: HTTP 400", "http", 400));
      expect(await grabMovieRelease({ token: release.token })).toEqual({
        ok: false,
        error: "Radarr didn't grab the release. Try again.",
      });
    });

    it("warns about a possible grab after a 5xx, since Radarr may have sent the release first", async () => {
      mocks.grabRelease.mockRejectedValue(new ArrRequestError("Radarr release grab request failed: HTTP 500", "http", 500));
      expect(await grabMovieRelease({ token: release.token })).toEqual({
        ok: false,
        error: "Radarr didn't confirm the grab. It may still have been sent, so check the queue before trying again.",
      });
    });

    it("warns about a possible grab after a network error", async () => {
      mocks.grabRelease.mockRejectedValue(new ArrRequestError("Radarr release grab request failed: network error", "network"));
      expect(await grabMovieRelease({ token: release.token })).toEqual({
        ok: false,
        error: "Radarr didn't confirm the grab. It may still have been sent, so check the queue before trying again.",
      });
    });

    it("rethrows errors that are not Radarr request failures", async () => {
      mocks.grabRelease.mockRejectedValue(new Error("config broken"));
      await expect(grabMovieRelease({ token: release.token })).rejects.toThrow("config broken");
    });
  });
});

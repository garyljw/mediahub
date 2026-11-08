import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
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
  recordReplaceGrab: vi.fn(),
}));

vi.mock("@/server/replace/replace-grabs", () => ({ recordReplaceGrab: mocks.recordReplaceGrab }));

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
import { MAX_SEARCH_MOVIES } from "@/components/movies/movie-search";

const ADDER = { id: "u1", email: "a@example.test", name: "A", role: "requester" };
const ADMIN = { id: "u1", email: "a@example.test", name: "A", role: "admin" };
const ADD_DENIED = "You don't have permission to add movies.";
const SEARCH_DENIED = "You don't have permission to search for movies.";
const REFRESH_DENIED = "You don't have permission to refresh movies.";
const PICK_DENIED = "You don't have permission to pick releases.";
const validAdd = { tmdbId: 910001 };
const release = { token: "00000000-0000-4000-8000-000000000001", title: "Starfall.2019.1080p" };
const GUID = "https://indexer.test/details/1";
const ROOT_FOLDERS = [
  { id: 7, path: "/invented/movies/", freeSpace: 1 },
  { id: 8, path: "/invented/other/", freeSpace: 2 },
];
const ADDED = { id: 42, title: "Lantern Harbour", year: 2021 };
const FILM = { tmdbId: 1, title: "Film", year: 2000, overview: "", inLibrary: false };
const ids = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

beforeEach(() => {
  vi.clearAllMocks();
  // Every mock an action can reach gets a success value here, so a test only overrides what it needs.
  mocks.requireRole.mockResolvedValue({ user: ADDER });
  mocks.lookupMovies.mockResolvedValue([FILM]);
  mocks.addMovie.mockResolvedValue(ADDED);
  mocks.listRootFolders.mockResolvedValue(ROOT_FOLDERS);
  mocks.listQualityProfiles.mockResolvedValue([
    { id: 1, name: "HD-1080p" },
    { id: 2, name: "Any" },
  ]);
  mocks.getMovieAddDefaults.mockReturnValue({ profileId: null, rootFolderId: null });
  mocks.searchMovieReleases.mockResolvedValue(undefined);
  mocks.refreshMovies.mockResolvedValue(undefined);
  mocks.searchReleases.mockResolvedValue({ rows: [], totals: { all: 0, usenet: 0, torrent: 0 } });
  mocks.grabRelease.mockResolvedValue({ title: release.title, guid: GUID });
  mocks.recordReplaceGrab.mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("authorization", () => {
  type AuthRow = { name: string; call: () => Promise<unknown>; roles: string[]; denied: string; upstream: Mock[] };

  // One row per action. `roles` are the role arguments requireRole must get. Every call uses valid input, so only the
  // role check can stop it. `upstream` lists the calls that must not happen when the caller is refused.
  const rows: AuthRow[] = [
    { name: "searchMovies", call: () => searchMovies({ term: "film" }), roles: ["admin", "requester"], denied: ADD_DENIED, upstream: [mocks.lookupMovies] },
    { name: "addLibraryMovie", call: () => addLibraryMovie(validAdd), roles: ["admin", "requester"], denied: ADD_DENIED, upstream: [mocks.listQualityProfiles, mocks.listRootFolders, mocks.addMovie] },
    { name: "searchLibraryMovies", call: () => searchLibraryMovies({ movieIds: [1] }), roles: ["admin", "requester"], denied: SEARCH_DENIED, upstream: [mocks.searchMovieReleases] },
    { name: "refreshLibraryMovies", call: () => refreshLibraryMovies({ movieIds: [1] }), roles: ["admin"], denied: REFRESH_DENIED, upstream: [mocks.refreshMovies] },
    { name: "findMovieReleases", call: () => findMovieReleases({ movieId: 1 }), roles: ["admin"], denied: PICK_DENIED, upstream: [mocks.searchReleases] },
    { name: "grabMovieRelease", call: () => grabMovieRelease({ token: release.token }), roles: ["admin"], denied: PICK_DENIED, upstream: [mocks.grabRelease] },
  ];

  it.each(rows)("$name asks for $roles", async ({ call, roles }) => {
    await call();
    expect(mocks.requireRole).toHaveBeenCalledWith(...roles);
  });

  // 401 and 403 take the same `instanceof AuthzError` branch in every action, so one status covers them.
  it.each(rows)("$name refuses a denied caller, and calls no upstream function", async ({ call, denied, upstream }) => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await call()).toEqual({ ok: false, error: denied });
    for (const mock of upstream) expect(mock).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(rows)("$name rethrows a non-authorization error, and calls no upstream function", async ({ call, upstream }) => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(call()).rejects.toThrow("database down");
    for (const mock of upstream) expect(mock).not.toHaveBeenCalled();
  });
});

describe("errors that are not Radarr request failures are rethrown", () => {
  const rethrowRows: [string, Mock, () => Promise<unknown>][] = [
    ["searchMovies", mocks.lookupMovies, () => searchMovies({ term: "film" })],
    ["addLibraryMovie", mocks.addMovie, () => addLibraryMovie(validAdd)],
    ["searchLibraryMovies", mocks.searchMovieReleases, () => searchLibraryMovies({ movieIds: [1] })],
    ["refreshLibraryMovies", mocks.refreshMovies, () => refreshLibraryMovies({ movieIds: [1] })],
    ["findMovieReleases", mocks.searchReleases, () => findMovieReleases({ movieId: 1 })],
    ["grabMovieRelease", mocks.grabRelease, () => grabMovieRelease({ token: release.token })],
  ];

  it.each(rethrowRows)("%s rethrows an error that is not a Radarr request failure", async (_name, mock, call) => {
    mock.mockRejectedValue(new Error("config broken"));
    await expect(call()).rejects.toThrow("config broken");
  });
});

describe("searchMovies", () => {
  it.each([
    ["an empty term", { term: "" }],
    ["a whitespace-only term", { term: "   " }],
    ["an overlong term", { term: "x".repeat(101) }],
    ["an extra key", { term: "film", page: 2 }],
    ["a missing term", {}],
    ["a non-string term", { term: 5 }],
  ])("rejects %s without calling Radarr", async (_name, input) => {
    expect(await searchMovies(input)).toEqual({ ok: false, error: "Enter a movie title to search for." });
    expect(mocks.lookupMovies).not.toHaveBeenCalled();
  });

  it("trims the term and accepts exactly 100 characters", async () => {
    await searchMovies({ term: `  ${"x".repeat(100)}  ` });
    expect(mocks.lookupMovies).toHaveBeenCalledWith("x".repeat(100));
  });

  it("returns the results on success", async () => {
    expect(await searchMovies({ term: "film" })).toEqual({ ok: true, results: [FILM] });
  });

  it("gives a friendly error and logs only the safe message when Radarr fails", async () => {
    mocks.lookupMovies.mockRejectedValue(new ArrRequestError("Radarr movie lookup request failed: HTTP 500"));
    expect(await searchMovies({ term: "film" })).toEqual({ ok: false, error: "Radarr couldn't complete the search. Try again." });
    expect(console.error).toHaveBeenCalledWith("Movie search: Radarr movie lookup request failed: HTTP 500");
  });
});

describe("addLibraryMovie for a requester", () => {
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
    expect(await addLibraryMovie(validAdd)).toEqual({ ok: true, ...ADDED });
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

  // Before the add request is sent, a timeout cannot mean Radarr added the movie, so the message is the plain one.
  it.each([
    ["the root folder list", mocks.listRootFolders],
    ["the lookup before the add", mocks.addMovie],
  ])("does not claim the movie may have been added when %s timed out", async (_name, mock) => {
    mock.mockRejectedValue(new ArrRequestError("Radarr request failed: timed out", "timeout"));
    expect(await addLibraryMovie(validAdd)).toEqual({ ok: false, error: "Radarr didn't accept the movie. Try again." });
    expect(mocks.refresh).not.toHaveBeenCalled();
    if (mock === mocks.listRootFolders) expect(mocks.addMovie).not.toHaveBeenCalled();
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
});

describe("addLibraryMovie for an admin", () => {
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
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  const chosen = { tmdbId: 910001, qualityProfileId: 1, rootFolderId: 8, monitored: false, searchForMovie: false };

  // The chosen profile and folder win over the saved defaults (2 and 7 here), so both differ from the defaults.
  it("adds with the chosen profile, folder, monitored and search values", async () => {
    mocks.getMovieAddDefaults.mockReturnValue({ profileId: 2, rootFolderId: 7 });
    expect(await addLibraryMovie(chosen)).toEqual({ ok: true, ...ADDED });
    expect(mocks.addMovie.mock.calls[0][0]).toStrictEqual({
      tmdbId: 910001,
      qualityProfileId: 1,
      rootFolderPath: "/invented/other/",
      monitored: false,
      searchForMovie: false,
    });
  });

  it.each([
    ["an unknown quality profile", { ...chosen, qualityProfileId: 99 }, "That quality profile no longer exists."],
    ["an unknown root folder", { ...chosen, rootFolderId: 99 }, "That root folder no longer exists."],
  ])("refuses %s without adding", async (_name, input, error) => {
    expect(await addLibraryMovie(input)).toEqual({ ok: false, error });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

// The two bulk actions differ only in their messages, id limit and upstream call, so one table drives both.
const bulkActions = [
  {
    name: "searchLibraryMovies",
    call: searchLibraryMovies,
    upstream: mocks.searchMovieReleases,
    max: MAX_SEARCH_MOVIES,
    invalid: "Invalid search.",
    count: "searched",
    failure: "Radarr didn't start the search. Try again.",
    log: "Movie search now",
    http500: "Radarr movie search command request failed: HTTP 500",
    timeout: "Radarr movie search command request failed: timed out",
  },
  {
    name: "refreshLibraryMovies",
    call: refreshLibraryMovies,
    upstream: mocks.refreshMovies,
    max: MAX_REFRESH_MOVIES,
    invalid: "Invalid refresh.",
    count: "refreshed",
    failure: "Radarr didn't start the refresh. Try again.",
    log: "Movie refresh",
    http500: "Radarr movie refresh command request failed: HTTP 500",
    timeout: "Radarr movie refresh command request failed: timed out",
  },
];

describe.each(bulkActions)("$name", (action) => {
  it.each([
    ["no ids", { movieIds: [] }],
    ["too many ids", { movieIds: ids(action.max + 1) }],
    ["a zero id", { movieIds: [0] }],
    ["a fractional id", { movieIds: [1.5] }],
    ["a string id", { movieIds: ["1"] }],
    ["an extra key", { movieIds: [1], monitored: true }],
    ["a missing list", {}],
    ["null", null],
  ])("rejects %s without calling Radarr", async (_name, input) => {
    expect(await action.call(input)).toEqual({ ok: false, error: action.invalid });
    expect(action.upstream).not.toHaveBeenCalled();
  });

  it("accepts exactly the maximum number of ids", async () => {
    expect(await action.call({ movieIds: ids(action.max) })).toEqual({ ok: true, [action.count]: action.max });
  });

  // A Set in the action drops duplicates, so Radarr gets each movie once. Neither action re-renders the page.
  it("sends each id once, reports the unique count, and does not refresh", async () => {
    expect(await action.call({ movieIds: [4, 5, 4] })).toEqual({ ok: true, [action.count]: 2 });
    expect(action.upstream).toHaveBeenCalledWith([4, 5]);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives a friendly error and logs only the safe message when Radarr fails", async () => {
    action.upstream.mockRejectedValue(new ArrRequestError(action.http500));
    expect(await action.call({ movieIds: [1] })).toEqual({ ok: false, error: action.failure });
    expect(console.error).toHaveBeenCalledWith(`${action.log}: ${action.http500}`);
  });

  it("warns that the work may have started after a timeout", async () => {
    action.upstream.mockRejectedValue(new ArrRequestError(action.timeout, "timeout"));
    expect(await action.call({ movieIds: [1] })).toEqual({ ok: false, error: expect.stringContaining("may still have started") });
  });
});

describe("findMovieReleases", () => {
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

    expect(await findMovieReleases({ movieId: 7 })).toEqual({ ok: true, releases: rows, totals });
    expect(mocks.searchReleases).toHaveBeenCalledWith(7);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says it timed out, and logs only the safe message", async () => {
    mocks.searchReleases.mockRejectedValue(new ArrRequestError("Radarr release search request failed: timed out", "timeout"));
    expect(await findMovieReleases({ movieId: 1 })).toEqual({
      ok: false,
      error: "Radarr took too long searching the indexers. Try again in a moment.",
    });
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
});

describe("grabMovieRelease", () => {
  it.each([
    ["a missing token", {}],
    ["a token that is not a UUID", { token: "not-a-uuid" }],
    ["a number token", { token: 12 }],
    ["an extra key", { token: release.token, guid: "https://indexer.test/details/1" }],
    ["a replaceExisting that is not a boolean", { token: release.token, replaceExisting: "yes" }],
    ["null", null],
  ])("rejects %s without calling Radarr", async (_name, input) => {
    expect(await grabMovieRelease(input)).toEqual({ ok: false, error: "Invalid grab." });
    expect(mocks.grabRelease).not.toHaveBeenCalled();
    expect(mocks.recordReplaceGrab).not.toHaveBeenCalled();
  });

  it("returns the title on success, and does not re-render the page", async () => {
    expect(await grabMovieRelease({ token: release.token })).toStrictEqual({ ok: true, title: release.title });
    expect(mocks.grabRelease).toHaveBeenCalledWith(release.token);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("remembers a successful grab with the server's guid when Replace existing file is ticked, and sends no guid back", async () => {
    const result = await grabMovieRelease({ token: release.token, replaceExisting: true });

    expect(mocks.recordReplaceGrab).toHaveBeenCalledWith("radarr", GUID);
    expect(result).toStrictEqual({ ok: true, title: release.title });
  });

  it.each([
    ["omitted", {}],
    ["false", { replaceExisting: false }],
  ])("does not remember the grab when Replace existing file is %s", async (_name, extra) => {
    await grabMovieRelease({ token: release.token, ...extra });
    expect(mocks.recordReplaceGrab).not.toHaveBeenCalled();
  });

  it("does not remember a grab that Radarr refused", async () => {
    mocks.grabRelease.mockRejectedValue(new ArrRequestError("Radarr release grab request failed: HTTP 409", "http", 409));
    await grabMovieRelease({ token: release.token, replaceExisting: true });
    expect(mocks.recordReplaceGrab).not.toHaveBeenCalled();
  });

  it("still returns the success, and logs only the safe message, when the grab can't be remembered", async () => {
    mocks.recordReplaceGrab.mockImplementation(() => {
      throw new Error("disk full at /private/path");
    });

    const result = await grabMovieRelease({ token: release.token, replaceExisting: true });

    expect(result).toStrictEqual({ ok: true, title: release.title });
    expect(console.error).toHaveBeenCalledWith("Replace grab: couldn't remember the grab");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("/private/path");
  });

  it("says the result expired when the token is unknown or used up", async () => {
    mocks.grabRelease.mockRejectedValue(new ReleaseGrabError("expired"));
    expect(await grabMovieRelease({ token: release.token })).toEqual({
      ok: false,
      error: "That result has expired. Search again.",
    });
  });

  it("warns about a possible grab after a timeout, and logs only the safe message", async () => {
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

  // Only a 4xx refusal means nothing was grabbed. A 5xx or a dropped connection can come after the release was sent.
  it.each([
    ["a 5xx", new ArrRequestError("Radarr release grab request failed: HTTP 500", "http", 500)],
    ["a dropped connection", new ArrRequestError("Radarr release grab request failed: network error", "network")],
  ])("warns about a possible grab after %s", async (_name, error) => {
    mocks.grabRelease.mockRejectedValue(error);
    expect(await grabMovieRelease({ token: release.token })).toEqual({
      ok: false,
      error: "Radarr didn't confirm the grab. It may still have been sent, so check the queue before trying again.",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  addToFocus: vi.fn(),
  listFocusIds: vi.fn(),
  removeFromFocus: vi.fn(),
  reorderFocus: vi.fn(),
  movieExists: vi.fn(),
  seriesExists: vi.fn(),
  refresh: vi.fn(),
  listQualityProfiles: vi.fn(),
  listRootFolders: vi.fn(),
  addMovie: vi.fn(),
  getMovieAddDefaults: vi.fn(),
  listSeriesQualityProfiles: vi.fn(),
  listSeriesRootFolders: vi.fn(),
  addSeries: vi.fn(),
  getSeriesAddDefaults: vi.fn(),
  titleSearch: vi.fn(),
  requestFocusSync: vi.fn(),
}));

vi.mock("@/server/focus/plex-sync", () => ({ requestFocusSync: mocks.requestFocusSync }));

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
vi.mock("@/server/arr/movies", () => ({ movieExists: mocks.movieExists, listQualityProfiles: mocks.listQualityProfiles }));
vi.mock("@/server/arr/series", () => ({
  seriesExists: mocks.seriesExists,
  listSeriesQualityProfiles: mocks.listSeriesQualityProfiles,
}));
vi.mock("@/server/settings/add-defaults", () => ({
  getMovieAddDefaults: mocks.getMovieAddDefaults,
  getSeriesAddDefaults: mocks.getSeriesAddDefaults,
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
    addMovie: mocks.addMovie,
    listRootFolders: mocks.listRootFolders,
    lookupMovies: vi.fn(),
  };
});

vi.mock("@/server/arr/series-add", () => {
  class SeriesAddError extends Error {
    constructor(readonly reason: "not-found" | "exists") {
      super(reason);
      this.name = "SeriesAddError";
    }
  }
  return {
    SeriesAddError,
    addSeries: mocks.addSeries,
    listSeriesRootFolders: mocks.listSeriesRootFolders,
    lookupSeries: vi.fn(),
  };
});

vi.mock("@/server/title-search", () => {
  class TitleSearchError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "TitleSearchError";
    }
  }
  return { TitleSearchError, titleSearch: () => ({ search: mocks.titleSearch }) };
});

vi.mock("@/server/focus/focus", () => {
  class FocusOrderError extends Error {}
  class FocusLimitError extends Error {}
  return {
    MAX_FOCUS_ITEMS: 500,
    FocusOrderError,
    FocusLimitError,
    addToFocus: mocks.addToFocus,
    listFocusIds: mocks.listFocusIds,
    removeFromFocus: mocks.removeFromFocus,
    reorderFocus: mocks.reorderFocus,
  };
});

import { AuthzError } from "@/server/authz";
import { ArrRequestError } from "@/server/arr/request";
import { FocusLimitError, FocusOrderError } from "@/server/focus/focus";
import { MovieAddError } from "@/server/arr/movie-add";
import { SeriesAddError } from "@/server/arr/series-add";
import { TitleSearchError, type TitleHit } from "@/server/title-search";
import { addFocusItem, addNewToFocus, removeFocusItems, reorderFocusItems, searchFocusTitles } from "./actions";

const REQUESTER = { id: "u1", email: "r@example.test", name: "R", role: "requester" };
const DENIED = "You don't have permission to change Focus lists.";
const INVALID = "That change couldn't be read. Refresh and try again.";

const ADMIN = { id: "a1", email: "a@example.test", name: "A", role: "admin" };
const SEARCH_DENIED = "You don't have permission to search for titles to add.";
const SEARCH_INVALID = "Enter a title to search for.";

beforeEach(() => {
  vi.clearAllMocks();
  // Some tests make addToFocus throw; clearAllMocks keeps implementations, so reset it here.
  mocks.addToFocus.mockReset();
  mocks.requireRole.mockResolvedValue({ user: REQUESTER });
  mocks.listFocusIds.mockReturnValue([]);
  mocks.movieExists.mockResolvedValue(true);
  mocks.seriesExists.mockResolvedValue(true);
  mocks.getMovieAddDefaults.mockReturnValue({ profileId: 1, rootFolderId: 2 });
  mocks.getSeriesAddDefaults.mockReturnValue({ profileId: 1, rootFolderId: 2, monitor: "all" });
  mocks.listQualityProfiles.mockResolvedValue([
    { id: 1, name: "HD" },
    { id: 5, name: "Ultra" },
  ]);
  mocks.listRootFolders.mockResolvedValue([{ id: 2, path: "/movies" }]);
  mocks.listSeriesQualityProfiles.mockResolvedValue([{ id: 1, name: "HD" }]);
  mocks.listSeriesRootFolders.mockResolvedValue([{ id: 2, path: "/tv" }]);
  mocks.addMovie.mockResolvedValue({ id: 77, title: "Fight Club", year: 1999 });
  mocks.addSeries.mockResolvedValue({ id: 88, title: "Dark", year: 2017 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const signedOut = () => mocks.requireRole.mockRejectedValue(new AuthzError(401));
const forbidden = () => mocks.requireRole.mockRejectedValue(new AuthzError(403));

describe("addFocusItem", () => {
  it("allows both admin and requester, checks the title in its own app, and adds it as the caller", async () => {
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: true });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
    expect(mocks.movieExists).toHaveBeenCalledWith(4);
    expect(mocks.seriesExists).not.toHaveBeenCalled();
    expect(mocks.addToFocus).toHaveBeenCalledWith("movie", 4, "u1");
  });

  it("checks Sonarr for a series", async () => {
    expect(await addFocusItem({ kind: "series", id: 9 })).toEqual({ ok: true });
    expect(mocks.seriesExists).toHaveBeenCalledWith(9);
    expect(mocks.movieExists).not.toHaveBeenCalled();
  });

  it.each([
    ["signed out", signedOut],
    ["a forbidden role", forbidden],
  ])("refuses %s and writes nothing", async (_label, deny) => {
    deny();
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: false, error: DENIED });
    expect(mocks.addToFocus).not.toHaveBeenCalled();
    expect(mocks.movieExists).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown kind", { kind: "music", id: 4 }],
    ["a zero id", { kind: "movie", id: 0 }],
    ["a negative id", { kind: "movie", id: -4 }],
    ["a fractional id", { kind: "movie", id: 1.5 }],
    ["a string id", { kind: "movie", id: "4" }],
    ["an extra key", { kind: "movie", id: 4, user: "x" }],
    ["a missing id", { kind: "movie" }],
    ["a non-object", "movie:4"],
  ])("refuses %s without calling the app or writing", async (_label, input) => {
    expect(await addFocusItem(input)).toEqual({ ok: false, error: INVALID });
    expect(mocks.movieExists).not.toHaveBeenCalled();
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it("refuses a title the app doesn't have, and writes nothing", async () => {
    mocks.movieExists.mockResolvedValue(false);
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: false, error: "That title isn't in Radarr." });
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it("refuses a series Sonarr doesn't have, naming Sonarr", async () => {
    mocks.seriesExists.mockResolvedValue(false);
    expect(await addFocusItem({ kind: "series", id: 4 })).toEqual({ ok: false, error: "That title isn't in Sonarr." });
  });

  it("reports an app outage with the safe message and logs only the error message", async () => {
    mocks.movieExists.mockRejectedValue(new ArrRequestError("Radarr movie request failed: HTTP 503", "http", 503));
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: false, error: "Couldn't reach Radarr. Try again." });
    expect(console.error).toHaveBeenCalledWith("Focus add: Radarr movie request failed: HTTP 503");
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it("names Sonarr in the outage message for a series", async () => {
    mocks.seriesExists.mockRejectedValue(new ArrRequestError("Sonarr series request failed", "http", 500));
    expect(await addFocusItem({ kind: "series", id: 4 })).toEqual({ ok: false, error: "Couldn't reach Sonarr. Try again." });
  });

  it("rethrows errors that are not Arr request failures", async () => {
    mocks.movieExists.mockRejectedValue(new Error("config broken"));
    await expect(addFocusItem({ kind: "movie", id: 1 })).rejects.toThrow("config broken");
  });

  it("is a no-op success for a title already in the list, without asking the app", async () => {
    mocks.listFocusIds.mockReturnValue([4, 9]);
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: true });
    expect(mocks.movieExists).not.toHaveBeenCalled();
    expect(mocks.addToFocus).toHaveBeenCalledWith("movie", 4, "u1");
  });

  it("shows the limit message when the list is full", async () => {
    mocks.addToFocus.mockImplementation(() => {
      throw new FocusLimitError();
    });
    expect((await addFocusItem({ kind: "series", id: 9 })).ok).toBe(false);
  });
});

describe.each([
  ["removeFocusItems", removeFocusItems],
] as const)("%s", (_name, action) => {
  it("allows both admin and requester and removes the ids of that kind", async () => {
    expect(await action({ kind: "movie", ids: [4, 5] })).toEqual({ ok: true });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
    expect(mocks.removeFromFocus).toHaveBeenCalledWith("movie", [4, 5]);
  });

  it.each([
    ["signed out", signedOut],
    ["a forbidden role", forbidden],
  ])("refuses %s and removes nothing", async (_label, deny) => {
    deny();
    expect(await action({ kind: "movie", ids: [4] })).toEqual({ ok: false, error: DENIED });
    expect(mocks.removeFromFocus).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty id list", { kind: "movie", ids: [] }],
    ["duplicate ids", { kind: "movie", ids: [1, 1] }],
    ["a negative id", { kind: "movie", ids: [1, -2] }],
    ["an extra key", { kind: "movie", ids: [1], user: "x" }],
    ["an unknown kind", { kind: "book", ids: [1] }],
    ["too many ids", { kind: "movie", ids: Array.from({ length: 501 }, (_, i) => i + 1) }],
  ])("refuses %s without removing", async (_label, input) => {
    expect(await action(input)).toEqual({ ok: false, error: INVALID });
    expect(mocks.removeFromFocus).not.toHaveBeenCalled();
  });
});

describe("reorderFocusItems", () => {
  it("writes the new full order for the kind", async () => {
    expect(await reorderFocusItems({ kind: "movie", ids: [3, 1, 2] })).toEqual({ ok: true });
    expect(mocks.reorderFocus).toHaveBeenCalledWith("movie", [3, 1, 2]);
  });

  it("allows an empty list", async () => {
    expect(await reorderFocusItems({ kind: "series", ids: [] })).toEqual({ ok: true });
  });

  it("refuses a stale order with the list-changed message and flags it as stale", async () => {
    mocks.reorderFocus.mockImplementation(() => {
      throw new FocusOrderError();
    });
    expect(await reorderFocusItems({ kind: "movie", ids: [1, 2] })).toEqual({
      ok: false,
      error: "The list changed. Refresh and try again.",
      stale: true,
    });
  });

  it.each([
    ["duplicate ids", { kind: "movie", ids: [1, 1] }],
    ["a negative id", { kind: "movie", ids: [1, -2] }],
    ["an extra key", { kind: "movie", ids: [1], order: "x" }],
    ["an unknown kind", { kind: "book", ids: [1] }],
    ["too many ids", { kind: "movie", ids: Array.from({ length: 501 }, (_, i) => i + 1) }],
  ])("refuses %s without writing", async (_label, input) => {
    expect(await reorderFocusItems(input)).toEqual({ ok: false, error: INVALID });
    expect(mocks.reorderFocus).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    signedOut();
    expect(await reorderFocusItems({ kind: "movie", ids: [1] })).toEqual({ ok: false, error: DENIED });
    expect(mocks.reorderFocus).not.toHaveBeenCalled();
  });
});

function hit(overrides: Partial<TitleHit> = {}): TitleHit {
  return {
    externalId: 550,
    title: "Fight Club",
    year: 1999,
    network: null,
    overview: "An insomniac office worker.",
    posterSrc: "/api/movies/lookup-poster/abc.jpg",
    inLibrary: false,
    ...overrides,
  };
}

describe("searchFocusTitles", () => {
  it("allows both admin and requester, and searches the title source for the kind", async () => {
    mocks.titleSearch.mockResolvedValue([]);
    expect(await searchFocusTitles({ kind: "movie", term: "  dune " })).toEqual({ ok: true, hits: [] });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
    expect(mocks.titleSearch).toHaveBeenCalledWith("movie", "dune");
  });

  it("maps the series list to the series kind", async () => {
    mocks.titleSearch.mockResolvedValue([]);
    await searchFocusTitles({ kind: "series", term: "dark" });
    expect(mocks.titleSearch).toHaveBeenCalledWith("series", "dark");
  });

  it.each([
    ["signed out", () => mocks.requireRole.mockRejectedValue(new AuthzError(401))],
    ["a forbidden role", () => mocks.requireRole.mockRejectedValue(new AuthzError(403))],
  ])("refuses %s and never searches", async (_label, deny) => {
    deny();
    expect(await searchFocusTitles({ kind: "movie", term: "dune" })).toEqual({ ok: false, error: SEARCH_DENIED });
    expect(mocks.titleSearch).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown kind", { kind: "book", term: "dune" }],
    ["an extra key", { kind: "movie", term: "dune", tmdbId: 1 }],
    ["a blank term", { kind: "movie", term: "   " }],
    ["an empty term", { kind: "movie", term: "" }],
    ["a term over 100 characters", { kind: "movie", term: "x".repeat(101) }],
    ["a missing term", { kind: "movie" }],
    ["a non-object", "dune"],
  ])("refuses %s without searching", async (_label, input) => {
    expect(await searchFocusTitles(input)).toEqual({ ok: false, error: SEARCH_INVALID });
    expect(mocks.titleSearch).not.toHaveBeenCalled();
  });

  it("leaves out titles that are already in the library", async () => {
    const inLibrary = hit({ externalId: 1, inLibrary: true });
    const notYet = hit({ externalId: 2, inLibrary: false });
    mocks.titleSearch.mockResolvedValue([inLibrary, notYet]);
    expect(await searchFocusTitles({ kind: "movie", term: "dune" })).toEqual({ ok: true, hits: [notYet] });
  });

  it("gives the app's own message when the search fails, and rethrows anything else", async () => {
    mocks.titleSearch.mockRejectedValueOnce(new TitleSearchError("Sonarr couldn't complete the search"));
    expect(await searchFocusTitles({ kind: "series", term: "dark" })).toEqual({
      ok: false,
      error: "Sonarr couldn't complete the search. Try again.",
    });
    mocks.titleSearch.mockRejectedValueOnce(new TitleSearchError("Radarr couldn't complete the search"));
    expect(await searchFocusTitles({ kind: "movie", term: "dune" })).toEqual({
      ok: false,
      error: "Radarr couldn't complete the search. Try again.",
    });
    mocks.titleSearch.mockRejectedValueOnce(new Error("config broken"));
    await expect(searchFocusTitles({ kind: "movie", term: "dune" })).rejects.toThrow("config broken");
  });
});

describe("addNewToFocus", () => {
  it("adds a movie as a requester with the saved defaults, then appends it to Movie Focus as the caller", async () => {
    expect(await addNewToFocus({ kind: "movie", add: { tmdbId: 550 } })).toEqual({ ok: true });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
    expect(mocks.addMovie).toHaveBeenCalledWith(
      { tmdbId: 550, qualityProfileId: 1, rootFolderPath: "/movies", monitored: true, searchForMovie: true },
      expect.any(Function),
    );
    expect(mocks.addToFocus).toHaveBeenCalledWith("movie", 77, "u1");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("adds a series as a requester with the saved defaults, then appends it to TV Focus", async () => {
    expect(await addNewToFocus({ kind: "series", add: { tvdbId: 81189 } })).toEqual({ ok: true });
    expect(mocks.addSeries).toHaveBeenCalledWith(
      expect.objectContaining({ tvdbId: 81189, qualityProfileId: 1, rootFolderPath: "/tv", monitor: "all" }),
      expect.any(Function),
    );
    expect(mocks.addToFocus).toHaveBeenCalledWith("series", 88, "u1");
  });

  it("lets an admin pick the profile and monitoring, and appends as the admin", async () => {
    mocks.requireRole.mockResolvedValue({ user: ADMIN });
    const add = { tmdbId: 550, qualityProfileId: 5, rootFolderId: 2, monitored: false, searchForMovie: false };
    expect(await addNewToFocus({ kind: "movie", add })).toEqual({ ok: true });
    expect(mocks.addMovie).toHaveBeenCalledWith(
      expect.objectContaining({ tmdbId: 550, qualityProfileId: 5, monitored: false, searchForMovie: false }),
      expect.any(Function),
    );
    expect(mocks.addToFocus).toHaveBeenCalledWith("movie", 77, "a1");
  });

  it("refuses a requester who sends admin fields, without adding or writing the list", async () => {
    const add = { tmdbId: 550, qualityProfileId: 5, rootFolderId: 2, monitored: true, searchForMovie: true };
    expect(await addNewToFocus({ kind: "movie", add })).toEqual({ ok: false, error: "Invalid add." });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it.each([
    ["signed out", () => mocks.requireRole.mockRejectedValue(new AuthzError(401))],
    ["a forbidden role", () => mocks.requireRole.mockRejectedValue(new AuthzError(403))],
  ])("refuses %s and adds nothing", async (_label, deny) => {
    deny();
    expect(await addNewToFocus({ kind: "movie", add: { tmdbId: 550 } })).toEqual({ ok: false, error: DENIED });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown kind", { kind: "book", add: { tmdbId: 550 } }],
    ["an extra key", { kind: "movie", add: { tmdbId: 550 }, id: 1 }],
    ["a missing add", { kind: "movie" }],
    ["a non-object", "movie"],
  ])("refuses %s without adding", async (_label, input) => {
    expect(await addNewToFocus(input)).toEqual({ ok: false, error: INVALID });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.addSeries).not.toHaveBeenCalled();
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it("passes the add's own message through and does not write the list when the add fails", async () => {
    mocks.addMovie.mockRejectedValue(new MovieAddError("exists"));
    expect(await addNewToFocus({ kind: "movie", add: { tmdbId: 550 } })).toEqual({
      ok: false,
      error: "That movie is already in your library.",
    });
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it("passes a series add failure through and does not write the list", async () => {
    mocks.addSeries.mockRejectedValue(new SeriesAddError("not-found"));
    expect(await addNewToFocus({ kind: "series", add: { tvdbId: 1 } })).toEqual({
      ok: false,
      error: "Sonarr couldn't find that series.",
    });
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it("says the title is in Radarr but not in the list when the add reply has no id", async () => {
    mocks.addMovie.mockResolvedValue({ id: null, title: "Fight Club", year: 1999 });
    expect(await addNewToFocus({ kind: "movie", add: { tmdbId: 550 } })).toEqual({
      ok: false,
      error: "Added to Radarr, but it couldn't be added to Movie Focus. Find it on Home and add it from there.",
      addedToLibrary: true,
    });
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it("names Sonarr and TV Focus when a series add reply has no id", async () => {
    mocks.addSeries.mockResolvedValue({ id: null, title: "Dark", year: 2017 });
    expect(await addNewToFocus({ kind: "series", add: { tvdbId: 81189 } })).toEqual({
      ok: false,
      error: "Added to Sonarr, but it couldn't be added to TV Focus. Find it on Home and add it from there.",
      addedToLibrary: true,
    });
  });

  it("says the title is in the library but the list is full, and says what to do", async () => {
    mocks.addToFocus.mockImplementation(() => {
      throw new FocusLimitError();
    });
    expect(await addNewToFocus({ kind: "movie", add: { tmdbId: 550 } })).toEqual({
      ok: false,
      error: "Added to Radarr, but Movie Focus is full (up to 500 titles). Remove one, then add it from Home.",
      addedToLibrary: true,
    });
    expect(mocks.addMovie).toHaveBeenCalled();
  });

  it("refuses a full list before adding anything to the app", async () => {
    mocks.listFocusIds.mockReturnValue(Array.from({ length: 500 }, (_, index) => index + 1));
    expect(await addNewToFocus({ kind: "movie", add: { tmdbId: 550 } })).toEqual({
      ok: false,
      error: "A Focus list can hold up to 500 titles. Remove one before adding another.",
    });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });
});

describe("Plex sync requests", () => {
  it("asks for a sync after a successful add to the list", async () => {
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: true });
    expect(mocks.requestFocusSync).toHaveBeenCalledWith("movie");
  });

  it("asks for a sync after a remove that removed rows, but not one that removed nothing", async () => {
    mocks.removeFromFocus.mockReturnValueOnce(2);
    expect(await removeFocusItems({ kind: "series", ids: [1, 2] })).toEqual({ ok: true });
    expect(mocks.requestFocusSync).toHaveBeenCalledWith("series");

    mocks.requestFocusSync.mockClear();
    mocks.removeFromFocus.mockReturnValueOnce(0);
    expect(await removeFocusItems({ kind: "series", ids: [9] })).toEqual({ ok: true });
    expect(mocks.requestFocusSync).not.toHaveBeenCalled();
  });

  it("asks for a sync after a reorder", async () => {
    // An earlier test made reorderFocus throw; clearAllMocks keeps that implementation, so reset it here.
    mocks.reorderFocus.mockReset();
    expect(await reorderFocusItems({ kind: "movie", ids: [3, 1] })).toEqual({ ok: true });
    expect(mocks.requestFocusSync).toHaveBeenCalledWith("movie");
  });

  it("asks for a sync after a title is added to the list by add-new", async () => {
    expect(await addNewToFocus({ kind: "series", add: { tvdbId: 81189 } })).toEqual({ ok: true });
    expect(mocks.requestFocusSync).toHaveBeenCalledWith("series");
  });

  it("does not ask for a sync when the add-new title reached the app but not the list", async () => {
    mocks.addToFocus.mockImplementation(() => {
      throw new FocusLimitError();
    });
    expect((await addNewToFocus({ kind: "movie", add: { tmdbId: 550 } })).ok).toBe(false);
    expect(mocks.requestFocusSync).not.toHaveBeenCalled();
  });

  it("does not ask for a sync when the change is refused, invalid or stale", async () => {
    mocks.requireRole.mockRejectedValueOnce(new AuthzError(403));
    await addFocusItem({ kind: "movie", id: 4 });
    await reorderFocusItems({ kind: "movie", ids: [1, 1] });
    mocks.reorderFocus.mockImplementationOnce(() => {
      throw new FocusOrderError();
    });
    await reorderFocusItems({ kind: "movie", ids: [1] });
    expect(mocks.requestFocusSync).not.toHaveBeenCalled();
  });
});

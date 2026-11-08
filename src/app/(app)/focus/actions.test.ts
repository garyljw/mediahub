import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

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
const ADMIN = { id: "a1", email: "a@example.test", name: "A", role: "admin" };
const DENIED = "You don't have permission to change Focus lists.";
const INVALID = "That change couldn't be read. Refresh and try again.";
const FULL = "A Focus list can hold up to 500 titles. Remove one before adding another.";
const SEARCH_DENIED = "You don't have permission to search for titles to add.";
const SEARCH_INVALID = "Enter a title to search for.";
const TOO_MANY = Array.from({ length: 501 }, (_, i) => i + 1);

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations, so reset the mocks that some tests make throw or return once.
  mocks.addToFocus.mockReset();
  mocks.reorderFocus.mockReset();
  mocks.requireRole.mockResolvedValue({ user: REQUESTER });
  mocks.listFocusIds.mockReturnValue([]);
  mocks.movieExists.mockResolvedValue(true);
  mocks.seriesExists.mockResolvedValue(true);
  mocks.titleSearch.mockResolvedValue([]);
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

describe("authorization", () => {
  type AuthRow = { name: string; call: () => Promise<unknown>; roles: string[]; denied: unknown; upstream: Mock[] };

  // One row per action, called with valid input so only the role check can stop it. `upstream` must not be called
  // when the caller is refused.
  const rows: AuthRow[] = [
    {
      name: "addFocusItem",
      call: () => addFocusItem({ kind: "movie", id: 4 }),
      roles: ["admin", "requester"],
      denied: { ok: false, error: DENIED },
      upstream: [mocks.movieExists, mocks.addToFocus, mocks.requestFocusSync],
    },
    {
      name: "removeFocusItems",
      call: () => removeFocusItems({ kind: "movie", ids: [4] }),
      roles: ["admin", "requester"],
      denied: { ok: false, error: DENIED },
      upstream: [mocks.removeFromFocus, mocks.requestFocusSync],
    },
    {
      name: "reorderFocusItems",
      call: () => reorderFocusItems({ kind: "movie", ids: [1] }),
      roles: ["admin", "requester"],
      denied: { ok: false, error: DENIED },
      upstream: [mocks.reorderFocus, mocks.requestFocusSync],
    },
    {
      name: "searchFocusTitles",
      call: () => searchFocusTitles({ kind: "movie", term: "dune" }),
      roles: ["admin", "requester"],
      denied: { ok: false, error: SEARCH_DENIED },
      upstream: [mocks.titleSearch],
    },
    {
      name: "addNewToFocus",
      call: () => addNewToFocus({ kind: "movie", add: { tmdbId: 550 } }),
      roles: ["admin", "requester"],
      denied: { ok: false, error: DENIED },
      upstream: [mocks.addMovie, mocks.addToFocus, mocks.requestFocusSync, mocks.refresh],
    },
  ];

  // Signed-out (401) and forbidden (403) take the same branch in every action, so one status is enough.
  it.each(rows)("$name asks for $roles, and a refused caller gets the denial and no upstream call", async (row) => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await row.call()).toEqual(row.denied);
    expect(mocks.requireRole).toHaveBeenCalledWith(...row.roles);
    for (const mock of row.upstream) expect(mock).not.toHaveBeenCalled();
  });

  it.each(rows)("$name rethrows an error that is not an AuthzError", async (row) => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(row.call()).rejects.toThrow("database down");
    for (const mock of row.upstream) expect(mock).not.toHaveBeenCalled();
  });
});

it.each([
  ["addFocusItem", () => mocks.movieExists.mockRejectedValue(new Error("config broken")), () => addFocusItem({ kind: "movie", id: 1 })],
  [
    "searchFocusTitles",
    () => mocks.titleSearch.mockRejectedValue(new Error("config broken")),
    () => searchFocusTitles({ kind: "movie", term: "dune" }),
  ],
])("%s rethrows errors that are not upstream request failures", async (_name, fail, call) => {
  fail();
  await expect(call()).rejects.toThrow("config broken");
});

describe("addFocusItem", () => {
  it.each([
    ["movie", 4, mocks.movieExists, mocks.seriesExists],
    ["series", 9, mocks.seriesExists, mocks.movieExists],
  ])("checks a %s in its own app, adds it as the caller, and asks for a Plex sync", async (kind, id, own, other) => {
    expect(await addFocusItem({ kind, id })).toEqual({ ok: true });
    expect(own).toHaveBeenCalledWith(id);
    expect(other).not.toHaveBeenCalled();
    expect(mocks.addToFocus).toHaveBeenCalledWith(kind, id, "u1");
    expect(mocks.requestFocusSync).toHaveBeenCalledWith(kind);
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
    expect(mocks.requestFocusSync).not.toHaveBeenCalled();
  });

  it.each([
    ["movie", "Radarr", mocks.movieExists],
    ["series", "Sonarr", mocks.seriesExists],
  ])("refuses a %s the app doesn't have, naming %s, and writes nothing", async (kind, app, exists) => {
    exists.mockResolvedValue(false);
    expect(await addFocusItem({ kind, id: 4 })).toEqual({ ok: false, error: `That title isn't in ${app}.` });
    expect(mocks.addToFocus).not.toHaveBeenCalled();
    expect(mocks.requestFocusSync).not.toHaveBeenCalled();
  });

  it.each([
    ["movie", "Radarr", mocks.movieExists],
    ["series", "Sonarr", mocks.seriesExists],
  ])("reports a %s app outage with the safe message and logs only the error message", async (kind, app, exists) => {
    exists.mockRejectedValue(new ArrRequestError(`${app} request failed: HTTP 503`, "http", 503));
    expect(await addFocusItem({ kind, id: 4 })).toEqual({ ok: false, error: `Couldn't reach ${app}. Try again.` });
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    expect(console.error).toHaveBeenCalledWith(`Focus add: ${app} request failed: HTTP 503`);
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });

  it("is a no-op success for a title already in the list, without asking the app", async () => {
    mocks.listFocusIds.mockReturnValue([4, 9]);
    expect(await addFocusItem({ kind: "movie", id: 4 })).toEqual({ ok: true });
    expect(mocks.movieExists).not.toHaveBeenCalled();
    expect(mocks.addToFocus).toHaveBeenCalledWith("movie", 4, "u1");
  });

  it("shows the limit message when the list is full, and does not ask for a sync", async () => {
    mocks.addToFocus.mockImplementation(() => {
      throw new FocusLimitError();
    });
    expect(await addFocusItem({ kind: "series", id: 9 })).toEqual({ ok: false, error: FULL });
    expect(mocks.requestFocusSync).not.toHaveBeenCalled();
  });
});

describe("removeFocusItems", () => {
  it("removes the ids of that kind, and asks for a sync only when rows were removed", async () => {
    mocks.removeFromFocus.mockReturnValueOnce(2);
    expect(await removeFocusItems({ kind: "series", ids: [1, 2] })).toEqual({ ok: true });
    expect(mocks.removeFromFocus).toHaveBeenCalledWith("series", [1, 2]);
    expect(mocks.requestFocusSync).toHaveBeenCalledWith("series");

    mocks.requestFocusSync.mockClear();
    mocks.removeFromFocus.mockReturnValueOnce(0);
    expect(await removeFocusItems({ kind: "series", ids: [9] })).toEqual({ ok: true });
    expect(mocks.requestFocusSync).not.toHaveBeenCalled();
  });
});

// removeFocusItems and reorderFocusItems share the id rules, so one table covers both.
it.each([
  ["removeFocusItems: an empty id list", removeFocusItems, { kind: "movie", ids: [] }],
  ["removeFocusItems: duplicate ids", removeFocusItems, { kind: "movie", ids: [1, 1] }],
  ["removeFocusItems: a negative id", removeFocusItems, { kind: "movie", ids: [1, -2] }],
  ["removeFocusItems: an extra key", removeFocusItems, { kind: "movie", ids: [1], user: "x" }],
  ["removeFocusItems: an unknown kind", removeFocusItems, { kind: "book", ids: [1] }],
  ["removeFocusItems: too many ids", removeFocusItems, { kind: "movie", ids: TOO_MANY }],
  ["reorderFocusItems: duplicate ids", reorderFocusItems, { kind: "movie", ids: [1, 1] }],
  ["reorderFocusItems: a negative id", reorderFocusItems, { kind: "movie", ids: [1, -2] }],
  ["reorderFocusItems: an extra key", reorderFocusItems, { kind: "movie", ids: [1], order: "x" }],
  ["reorderFocusItems: an unknown kind", reorderFocusItems, { kind: "book", ids: [1] }],
  ["reorderFocusItems: too many ids", reorderFocusItems, { kind: "movie", ids: TOO_MANY }],
])("refuses %s without writing or asking for a sync", async (_label, action, input) => {
  expect(await action(input)).toEqual({ ok: false, error: INVALID });
  expect(mocks.removeFromFocus).not.toHaveBeenCalled();
  expect(mocks.reorderFocus).not.toHaveBeenCalled();
  expect(mocks.requestFocusSync).not.toHaveBeenCalled();
});

describe("reorderFocusItems", () => {
  it("writes the new full order for the kind, and asks for a sync", async () => {
    expect(await reorderFocusItems({ kind: "movie", ids: [3, 1, 2] })).toEqual({ ok: true });
    expect(mocks.reorderFocus).toHaveBeenCalledWith("movie", [3, 1, 2]);
    expect(mocks.requestFocusSync).toHaveBeenCalledWith("movie");
  });

  it("allows an empty list", async () => {
    expect(await reorderFocusItems({ kind: "series", ids: [] })).toEqual({ ok: true });
  });

  it("refuses a stale order with the list-changed message, flags it as stale, and does not ask for a sync", async () => {
    mocks.reorderFocus.mockImplementation(() => {
      throw new FocusOrderError();
    });
    expect(await reorderFocusItems({ kind: "movie", ids: [1, 2] })).toEqual({
      ok: false,
      error: "The list changed. Refresh and try again.",
      stale: true,
    });
    expect(mocks.requestFocusSync).not.toHaveBeenCalled();
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
  it.each([
    ["movie", "dune"],
    ["series", "dark"],
  ])("searches the %s source for the trimmed term, and leaves out titles already in the library", async (kind, term) => {
    const inLibrary = hit({ externalId: 1, inLibrary: true });
    const notYet = hit({ externalId: 2 });
    mocks.titleSearch.mockResolvedValue([inLibrary, notYet]);
    expect(await searchFocusTitles({ kind, term: `  ${term} ` })).toEqual({ ok: true, hits: [notYet] });
    expect(mocks.titleSearch).toHaveBeenCalledWith(kind, term);
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

  it.each([
    ["movie", "Radarr"],
    ["series", "Sonarr"],
  ])("says which app failed to search for a %s, using the app's name", async (kind, app) => {
    mocks.titleSearch.mockRejectedValue(new TitleSearchError(`${app} couldn't complete the search`));
    expect(await searchFocusTitles({ kind, term: "dune" })).toEqual({
      ok: false,
      error: `${app} couldn't complete the search. Try again.`,
    });
  });
});

describe("addNewToFocus", () => {
  it("adds a movie as a requester with the saved defaults, then appends it to Movie Focus as the caller", async () => {
    expect(await addNewToFocus({ kind: "movie", add: { tmdbId: 550 } })).toEqual({ ok: true });
    expect(mocks.addMovie).toHaveBeenCalledWith(
      { tmdbId: 550, qualityProfileId: 1, rootFolderPath: "/movies", monitored: true, searchForMovie: true },
      expect.any(Function),
    );
    expect(mocks.addToFocus).toHaveBeenCalledWith("movie", 77, "u1");
    expect(mocks.requestFocusSync).toHaveBeenCalledWith("movie");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("adds a series as a requester with the saved defaults, then appends it to TV Focus", async () => {
    expect(await addNewToFocus({ kind: "series", add: { tvdbId: 81189 } })).toEqual({ ok: true });
    expect(mocks.addSeries).toHaveBeenCalledWith(
      expect.objectContaining({ tvdbId: 81189, qualityProfileId: 1, rootFolderPath: "/tv", monitor: "all" }),
      expect.any(Function),
    );
    expect(mocks.addToFocus).toHaveBeenCalledWith("series", 88, "u1");
    expect(mocks.requestFocusSync).toHaveBeenCalledWith("series");
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

  it.each([
    [
      "a movie the app refuses to add",
      { kind: "movie", add: { tmdbId: 550 } },
      () => mocks.addMovie.mockRejectedValue(new MovieAddError("exists")),
      { ok: false, error: "That movie is already in your library." },
    ],
    [
      "a series the app refuses to add",
      { kind: "series", add: { tvdbId: 1 } },
      () => mocks.addSeries.mockRejectedValue(new SeriesAddError("not-found")),
      { ok: false, error: "Sonarr couldn't find that series." },
    ],
    [
      "a movie the app adds with no id",
      { kind: "movie", add: { tmdbId: 550 } },
      () => mocks.addMovie.mockResolvedValue({ id: null, title: "Fight Club", year: 1999 }),
      {
        ok: false,
        error: "Added to Radarr, but it couldn't be added to Movie Focus. Find it on Home and add it from there.",
        addedToLibrary: true,
      },
    ],
    [
      "a series the app adds with no id",
      { kind: "series", add: { tvdbId: 81189 } },
      () => mocks.addSeries.mockResolvedValue({ id: null, title: "Dark", year: 2017 }),
      {
        ok: false,
        error: "Added to Sonarr, but it couldn't be added to TV Focus. Find it on Home and add it from there.",
        addedToLibrary: true,
      },
    ],
  ])("returns the outcome for %s, and does not write the list or ask for a sync", async (_label, input, setup, expected) => {
    setup();
    expect(await addNewToFocus(input)).toEqual(expected);
    expect(mocks.addToFocus).not.toHaveBeenCalled();
    expect(mocks.requestFocusSync).not.toHaveBeenCalled();
  });

  it("says the title is in the app but the list is full, says what to do, and does not ask for a sync", async () => {
    mocks.addToFocus.mockImplementation(() => {
      throw new FocusLimitError();
    });
    expect(await addNewToFocus({ kind: "movie", add: { tmdbId: 550 } })).toEqual({
      ok: false,
      error: "Added to Radarr, but Movie Focus is full (up to 500 titles). Remove one, then add it from Home.",
      addedToLibrary: true,
    });
    expect(mocks.addMovie).toHaveBeenCalled();
    expect(mocks.requestFocusSync).not.toHaveBeenCalled();
  });

  it("refuses a full list before adding anything to the app", async () => {
    mocks.listFocusIds.mockReturnValue(Array.from({ length: 500 }, (_, index) => index + 1));
    expect(await addNewToFocus({ kind: "movie", add: { tmdbId: 550 } })).toEqual({ ok: false, error: FULL });
    expect(mocks.addMovie).not.toHaveBeenCalled();
    expect(mocks.addToFocus).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ArrRequestError } from "@/server/arr/request";
import { SeriesAddError } from "@/server/arr/series-add";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  refresh: vi.fn(),
  lookupSeries: vi.fn(),
  addSeries: vi.fn(),
  listSeriesRootFolders: vi.fn(),
  getSeriesAddDefaults: vi.fn(),
  searchSeriesReleases: vi.fn(),
  refreshSeries: vi.fn(),
  listSeriesQualityProfiles: vi.fn(),
}));

vi.mock("@/server/settings/add-defaults", () => ({ getSeriesAddDefaults: mocks.getSeriesAddDefaults }));

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

vi.mock("@/server/arr/series", () => ({
  listSeriesQualityProfiles: mocks.listSeriesQualityProfiles,
  searchSeriesReleases: mocks.searchSeriesReleases,
  refreshSeries: mocks.refreshSeries,
}));

vi.mock("@/server/arr/series-add", () => {
  class SeriesAddError extends Error {
    constructor(readonly reason: "not-found" | "exists") {
      super(reason);
      this.name = "SeriesAddError";
    }
  }
  return {
    SeriesAddError,
    lookupSeries: mocks.lookupSeries,
    addSeries: mocks.addSeries,
    listSeriesRootFolders: mocks.listSeriesRootFolders,
  };
});

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import { AuthzError } from "@/server/authz";
import { addLibrarySeries, refreshLibrarySeries, searchLibrarySeries, searchSeries } from "./actions";
import { MAX_REFRESH_SERIES } from "@/components/tv/series-refresh";
import { MAX_SEARCH_SERIES } from "@/components/tv/series-search";

const ADD_DENIED = "You don't have permission to add series.";
const SEARCH_DENIED = "You don't have permission to search for series.";
const REFRESH_DENIED = "You don't have permission to refresh series.";

const ADDER = { id: "u1", email: "a@example.test", name: "A", role: "requester" };
const ADMIN = { id: "u1", email: "a@example.test", name: "A", role: "admin" };
const PROFILES = [
  { id: 1, name: "HD-1080p" },
  { id: 2, name: "Any" },
];
const ROOT_TV = { id: 7, path: "/invented/tv/", freeSpace: null };
const ROOT_OTHER = { id: 8, path: "/invented/other-tv/", freeSpace: null };
const VALID_ADD = { tvdbId: 200001 };
const CHOSEN_ADD = {
  tvdbId: 200001,
  qualityProfileId: 1,
  rootFolderId: 8,
  monitor: "missing",
  seriesType: "anime",
  seasonFolder: false,
  searchForMissingEpisodes: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: ADMIN });
  mocks.lookupSeries.mockResolvedValue([{ tvdbId: 200001, title: "Harbour Lights", year: 2018, network: null, overview: "", inLibrary: false, posterPath: null }]);
  mocks.addSeries.mockResolvedValue({ id: 88, title: "Harbour Lights", year: 2018 });
  mocks.listSeriesRootFolders.mockResolvedValue([ROOT_TV, ROOT_OTHER]);
  mocks.listSeriesQualityProfiles.mockResolvedValue(PROFILES);
  mocks.getSeriesAddDefaults.mockReturnValue({ profileId: null, rootFolderId: null, monitor: null });
  mocks.searchSeriesReleases.mockResolvedValue(undefined);
  mocks.refreshSeries.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("authorization", () => {
  type AuthRow = {
    name: string;
    call: () => Promise<unknown>;
    roles: string[];
    denied: string;
    upstream: Mock[];
  };

  // One row per action. `roles` are the role arguments requireRole must get. `upstream` lists the calls that must
  // not happen when the caller is refused. Every call uses valid input, so only the role check can stop it.
  const rows: AuthRow[] = [
    { name: "searchSeries", call: () => searchSeries({ term: "Harbour" }), roles: ["admin", "requester"], denied: ADD_DENIED, upstream: [mocks.lookupSeries] },
    { name: "addLibrarySeries", call: () => addLibrarySeries(VALID_ADD), roles: ["admin", "requester"], denied: ADD_DENIED, upstream: [mocks.addSeries, mocks.listSeriesRootFolders] },
    { name: "searchLibrarySeries", call: () => searchLibrarySeries({ seriesIds: [1] }), roles: ["admin", "requester"], denied: SEARCH_DENIED, upstream: [mocks.searchSeriesReleases] },
    { name: "refreshLibrarySeries", call: () => refreshLibrarySeries({ seriesIds: [1] }), roles: ["admin"], denied: REFRESH_DENIED, upstream: [mocks.refreshSeries] },
  ];

  it.each(rows)("$name asks for $roles", async ({ call, roles }) => {
    await call();
    expect(mocks.requireRole).toHaveBeenCalledWith(...roles);
  });

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

describe("searchSeries", () => {
  it("rejects an empty or whitespace term, an unknown key and a non-string term without searching", async () => {
    for (const input of [{ term: "" }, { term: "   " }, { term: "x", tvdbId: 1 }, { term: 5 }, null]) {
      expect(await searchSeries(input)).toEqual({ ok: false, error: "Enter a series title to search for." });
    }
    expect(mocks.lookupSeries).not.toHaveBeenCalled();
  });

  it("trims the term and accepts exactly 100 characters", async () => {
    await searchSeries({ term: `  ${"x".repeat(100)}  ` });
    expect(mocks.lookupSeries).toHaveBeenCalledWith("x".repeat(100));
    expect(await searchSeries({ term: "x".repeat(101) })).toEqual({ ok: false, error: "Enter a series title to search for." });
  });

  it("returns the results on success", async () => {
    expect(await searchSeries({ term: "Harbour" })).toEqual({ ok: true, results: expect.any(Array) });
  });

  it("gives a friendly error and logs only the safe message when Sonarr fails", async () => {
    mocks.lookupSeries.mockRejectedValue(new ArrRequestError("Sonarr series lookup request failed: HTTP 500", "http", 500));
    expect(await searchSeries({ term: "Harbour" })).toEqual({ ok: false, error: "Sonarr couldn't complete the search. Try again." });
    expect(console.error).toHaveBeenCalledWith("Series search: Sonarr series lookup request failed: HTTP 500");
  });
});

const invalidRequesterAdd: [string, unknown][] = [
  ["not an object", "series"],
  ["null", null],
  ["a missing tvdbId", {}],
  ["a zero tvdbId", { tvdbId: 0 }],
  ["a fractional tvdbId", { tvdbId: 1.5 }],
  ["a string tvdbId", { tvdbId: "200001" }],
  ["a qualityProfileId", { ...VALID_ADD, qualityProfileId: 1 }],
  ["a rootFolderId", { ...VALID_ADD, rootFolderId: 7 }],
  ["a monitor", { ...VALID_ADD, monitor: "none" }],
  ["a seriesType", { ...VALID_ADD, seriesType: "anime" }],
  ["a searchForMissingEpisodes flag", { ...VALID_ADD, searchForMissingEpisodes: false }],
  ["a rootFolderPath", { ...VALID_ADD, rootFolderPath: "/invented/tv/" }],
  ["a title", { ...VALID_ADD, title: "Chosen Title" }],
];

// Every field the admin panel shows is required. Each one missing, or any extra key, is refused.
const invalidAdminAdd: [string, unknown][] = [
  ["a missing tvdbId", without("tvdbId")],
  ["a missing qualityProfileId", without("qualityProfileId")],
  ["a missing rootFolderId", without("rootFolderId")],
  ["a missing monitor", without("monitor")],
  ["a missing seriesType", without("seriesType")],
  ["a missing seasonFolder", without("seasonFolder")],
  ["a missing searchForMissingEpisodes", without("searchForMissingEpisodes")],
  ["a monitor that is not offered", { ...CHOSEN_ADD, monitor: "pilot" }],
  ["a bad series type", { ...CHOSEN_ADD, seriesType: "special" }],
  ["a string seasonFolder", { ...CHOSEN_ADD, seasonFolder: "false" }],
  ["a string profile id", { ...CHOSEN_ADD, qualityProfileId: "1" }],
  ["a rootFolderPath", { ...CHOSEN_ADD, rootFolderPath: "/invented/tv/" }],
  ["null", null],
];

function without(key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...CHOSEN_ADD };
  delete copy[key];
  return copy;
}

describe("addLibrarySeries input validation", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADDER });
  });

  // A requester sends only the TVDB id. Any other key is refused before Sonarr is read.
  it.each(invalidRequesterAdd)("refuses a requester's %s with Invalid add. and never calls Sonarr", async (_name, input) => {
    expect(await addLibrarySeries(input)).toEqual({ ok: false, error: "Invalid add." });
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.listSeriesRootFolders).not.toHaveBeenCalled();
    expect(mocks.addSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(invalidAdminAdd)("refuses an admin's %s with Invalid add. and never calls Sonarr", async (_name, input) => {
    mocks.requireRole.mockResolvedValue({ user: ADMIN });
    expect(await addLibrarySeries(input)).toEqual({ ok: false, error: "Invalid add." });
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.addSeries).not.toHaveBeenCalled();
  });
});

describe("addLibrarySeries for a requester", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADDER });
  });

  it("adds with the saved profile, folder and monitor, standard type, and search on", async () => {
    mocks.getSeriesAddDefaults.mockReturnValue({ profileId: 2, rootFolderId: 8, monitor: "missing" });

    await addLibrarySeries(VALID_ADD);

    expect(mocks.addSeries).toHaveBeenCalledWith(
      {
        tvdbId: 200001,
        qualityProfileId: 2,
        rootFolderPath: "/invented/other-tv/",
        monitor: "missing",
        seriesType: "standard",
        seasonFolder: true,
        searchForMissingEpisodes: true,
      },
      expect.any(Function),
    );
  });

  it("uses the monitor default of all when no monitor is saved", async () => {
    await addLibrarySeries(VALID_ADD);

    expect(mocks.addSeries.mock.calls[0][0]).toMatchObject({ monitor: "all", seriesType: "standard", searchForMissingEpisodes: true });
  });

  it("falls back to the first profile and folder when the saved ids are stale", async () => {
    mocks.getSeriesAddDefaults.mockReturnValue({ profileId: 99, rootFolderId: 99, monitor: "none" });

    await addLibrarySeries(VALID_ADD);

    expect(mocks.addSeries.mock.calls[0][0]).toMatchObject({ qualityProfileId: 1, rootFolderPath: "/invented/tv/", monitor: "none" });
  });

  it("returns the new id, title and year, then refreshes", async () => {
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: true, id: 88, title: "Harbour Lights", year: 2018 });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Sonarr has no root folders", () => mocks.listSeriesRootFolders.mockResolvedValue([]), "Sonarr has no root folders set up, so series can't be added yet."],
    ["Sonarr has no quality profiles", () => mocks.listSeriesQualityProfiles.mockResolvedValue([]), "Sonarr has no quality profiles set up, so series can't be added yet."],
  ])("refuses when %s, without adding", async (_name, setup, error) => {
    setup();
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: false, error });
    expect(mocks.addSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["exists", "That series is already in your library."],
    ["not-found", "Sonarr couldn't find that series."],
  ] as const)("maps a SeriesAddError of %s to its message, and does not refresh", async (reason, error) => {
    mocks.addSeries.mockRejectedValue(new SeriesAddError(reason));
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: false, error });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error and logs the safe message when Sonarr rejects the add", async () => {
    mocks.addSeries.mockRejectedValue(new ArrRequestError("Sonarr series add request failed: HTTP 400", "http", 400));
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: false, error: "Sonarr didn't accept the series. Try again." });
    expect(console.error).toHaveBeenCalledWith("Series add: Sonarr series add request failed: HTTP 400");
  });

  // Only a timeout after the add was sent can mean Sonarr added the series. A timeout or a 500 before that does not.
  it.each([
    ["the lookup before the add timed out", () => mocks.addSeries.mockRejectedValue(new ArrRequestError("Sonarr series lookup request failed: timed out", "timeout")), true],
    ["the root folder read timed out", () => mocks.listSeriesRootFolders.mockRejectedValue(new ArrRequestError("Sonarr root folder request failed: timed out", "timeout")), false],
    ["the root folder read answered 500", () => mocks.listSeriesRootFolders.mockRejectedValue(new ArrRequestError("Sonarr root folder request failed: HTTP 500", "http", 500)), false],
  ])("says Sonarr didn't accept when %s, before the add was sent", async (_name, setup, reachedAdd) => {
    setup();
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: false, error: "Sonarr didn't accept the series. Try again." });
    expect(mocks.addSeries).toHaveBeenCalledTimes(reachedAdd ? 1 : 0);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says the series may still have been added when the add times out after it was sent, and logs the safe message", async () => {
    mocks.addSeries.mockImplementation(async (_add: unknown, onSend: () => void) => {
      onSend();
      throw new ArrRequestError("Sonarr series add request failed: timed out", "timeout");
    });
    expect(await addLibrarySeries(VALID_ADD)).toEqual({
      ok: false,
      error: "Sonarr took too long to answer. The series may still have been added, so reload the page to check.",
    });
    expect(console.error).toHaveBeenCalledWith("Series add: Sonarr series add request failed: timed out");
  });
});

describe("addLibrarySeries for an admin", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADMIN });
  });

  it("adds with every chosen value and returns the new id", async () => {
    mocks.getSeriesAddDefaults.mockReturnValue({ profileId: 2, rootFolderId: 7, monitor: "future" });
    expect(await addLibrarySeries(CHOSEN_ADD)).toEqual({ ok: true, id: 88, title: "Harbour Lights", year: 2018 });
    expect(mocks.addSeries.mock.calls[0][0]).toStrictEqual({
      tvdbId: 200001,
      qualityProfileId: 1,
      rootFolderPath: "/invented/other-tv/",
      monitor: "missing",
      seriesType: "anime",
      seasonFolder: false,
      searchForMissingEpisodes: false,
    });
  });

  it("does not use the saved defaults when the admin sends choices", async () => {
    mocks.getSeriesAddDefaults.mockReturnValue({ profileId: 2, rootFolderId: 8, monitor: "none" });
    await addLibrarySeries({ ...CHOSEN_ADD, qualityProfileId: 1, rootFolderId: 7, monitor: "all" });
    expect(mocks.addSeries.mock.calls[0][0]).toMatchObject({ qualityProfileId: 1, rootFolderPath: "/invented/tv/", monitor: "all" });
  });

  it.each([
    ["an unknown quality profile", { qualityProfileId: 99 }, "That quality profile no longer exists."],
    ["an unknown root folder", { rootFolderId: 99 }, "That root folder no longer exists."],
  ])("refuses %s without adding", async (_name, override, error) => {
    expect(await addLibrarySeries({ ...CHOSEN_ADD, ...override })).toEqual({ ok: false, error });
    expect(mocks.addSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

// The two Sonarr list actions. Their input checks and failure handling are the same shape, so one table covers both.
const listActions = [
  {
    name: "searchLibrarySeries",
    call: searchLibrarySeries,
    max: MAX_SEARCH_SERIES,
    invalid: "Invalid search.",
    upstream: mocks.searchSeriesReleases,
    okAtMax: { ok: true, searched: MAX_SEARCH_SERIES },
    timeoutError: "Sonarr took too long to answer. The search may still have started, so check Sonarr before trying again.",
    failError: "Sonarr didn't start the search. Try again.",
    httpMessage: "Sonarr series search command request failed: HTTP 500",
    logPrefix: "Series search now",
  },
  {
    name: "refreshLibrarySeries",
    call: refreshLibrarySeries,
    max: MAX_REFRESH_SERIES,
    invalid: "Invalid refresh.",
    upstream: mocks.refreshSeries,
    okAtMax: { ok: true, refreshed: MAX_REFRESH_SERIES },
    timeoutError: "Sonarr took too long to answer. The refresh may still have started, so check Sonarr before trying again.",
    failError: "Sonarr didn't start the refresh. Try again.",
    httpMessage: "Sonarr series refresh command request failed: HTTP 500",
    logPrefix: "Series refresh",
  },
];

const idsUpTo = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

describe.each(listActions)("$name", (action) => {
  it.each([
    ["no ids", { seriesIds: [] }],
    ["too many ids", { seriesIds: idsUpTo(action.max + 1) }],
    ["a zero id", { seriesIds: [0] }],
    ["a fractional id", { seriesIds: [1.5] }],
    ["a string id", { seriesIds: ["1"] }],
    ["an extra key", { seriesIds: [1], monitored: true }],
    ["a missing list", {}],
    ["null", null],
  ])("rejects %s without calling Sonarr", async (_name, input) => {
    expect(await action.call(input)).toEqual({ ok: false, error: action.invalid });
    expect(action.upstream).not.toHaveBeenCalled();
  });

  it("accepts exactly the maximum, and does not re-render the page", async () => {
    expect(await action.call({ seriesIds: idsUpTo(action.max) })).toEqual(action.okAtMax);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says it timed out, so the work may have started, and sends nothing after the first request", async () => {
    action.upstream.mockRejectedValue(new ArrRequestError("timed out", "timeout"));
    expect(await action.call({ seriesIds: [1, 2] })).toEqual({ ok: false, error: action.timeoutError });
    expect(action.upstream).toHaveBeenCalledTimes(1);
  });

  it("says it didn't start when the first request answers 500, and logs only the safe message", async () => {
    action.upstream.mockRejectedValue(new ArrRequestError(action.httpMessage, "http", 500));
    expect(await action.call({ seriesIds: [1, 2] })).toEqual({ ok: false, error: action.failError });
    expect(console.error).toHaveBeenCalledWith(`${action.logPrefix}: ${action.httpMessage}`);
    expect(action.upstream).toHaveBeenCalledTimes(1);
  });
});

describe("searchLibrarySeries", () => {
  it("sends each id once, in order, and reports the unique count", async () => {
    expect(await searchLibrarySeries({ seriesIds: [4, 5, 4] })).toEqual({ ok: true, searched: 2 });
    expect(mocks.searchSeriesReleases.mock.calls).toEqual([[4], [5]]);
  });

  it("reports how far it got when a later search fails, and stops before the rest", async () => {
    mocks.searchSeriesReleases
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ArrRequestError("Sonarr series search command request failed: network error", "network"));
    expect(await searchLibrarySeries({ seriesIds: [1, 2, 3, 4] })).toEqual({
      ok: false,
      error: "Sonarr started searches for 2 of 4 series, then the next one failed. Check Sonarr before searching the rest.",
      startedIds: [1, 2],
    });
    expect(mocks.searchSeriesReleases.mock.calls).toEqual([[1], [2], [3]]);
  });

  it("says a later search may have started when it times out", async () => {
    mocks.searchSeriesReleases
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ArrRequestError("timed out", "timeout"));
    expect(await searchLibrarySeries({ seriesIds: [7, 8, 9] })).toEqual({
      ok: false,
      error:
        "Sonarr started searches for 1 of 3 series, then took too long on the next one, which may also have started. Check Sonarr before searching the rest.",
      startedIds: [7],
    });
    expect(mocks.searchSeriesReleases.mock.calls).toEqual([[7], [8]]);
  });
});

describe("refreshLibrarySeries", () => {
  it("passes the deduplicated list in one call and reports the unique count", async () => {
    expect(await refreshLibrarySeries({ seriesIds: [4, 5, 4, 3] })).toEqual({ ok: true, refreshed: 3 });
    expect(mocks.refreshSeries.mock.calls).toEqual([[[4, 5, 3]]]);
  });
});

describe("errors that are not Sonarr request failures are rethrown", () => {
  const rethrowRows: [string, Mock, () => Promise<unknown>][] = [
    ["searchSeries", mocks.lookupSeries, () => searchSeries({ term: "Harbour" })],
    ["addLibrarySeries", mocks.addSeries, () => addLibrarySeries(CHOSEN_ADD)],
    ["searchLibrarySeries", mocks.searchSeriesReleases, () => searchLibrarySeries({ seriesIds: [1] })],
    ["refreshLibrarySeries", mocks.refreshSeries, () => refreshLibrarySeries({ seriesIds: [1] })],
  ];

  it.each(rethrowRows)("%s rethrows an error that is not a Sonarr request failure", async (_name, mock, call) => {
    mock.mockRejectedValue(new Error("unexpected"));
    await expect(call()).rejects.toThrow("unexpected");
  });
});

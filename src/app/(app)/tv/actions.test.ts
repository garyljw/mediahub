import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";
import { SeriesAddError } from "@/server/arr/series-add";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  deleteSeries: vi.fn(),
  listSeriesQualityProfiles: vi.fn(),
  refresh: vi.fn(),
  lookupSeries: vi.fn(),
  addSeries: vi.fn(),
  listSeriesRootFolders: vi.fn(),
  getSeriesAddDefaults: vi.fn(),
  searchSeriesReleases: vi.fn(),
  refreshSeries: vi.fn(),
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
  deleteSeries: mocks.deleteSeries,
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
import {
  addLibrarySeries,
  refreshLibrarySeries,
  removeSeries,
  searchLibrarySeries,
  searchSeries,
} from "./actions";
import { MAX_BULK_SERIES } from "@/components/tv/series-bulk";
import { MAX_REFRESH_SERIES } from "@/components/tv/series-refresh";
import { MAX_SEARCH_SERIES } from "@/components/tv/series-search";

const DELETE_DENIED = "You don't have permission to delete series.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.deleteSeries.mockResolvedValue(undefined);
  mocks.searchSeriesReleases.mockResolvedValue(undefined);
  mocks.refreshSeries.mockResolvedValue(undefined);
  mocks.listSeriesQualityProfiles.mockResolvedValue([
    { id: 1, name: "HD-1080p" },
    { id: 2, name: "Any" },
  ]);
  mocks.getSeriesAddDefaults.mockReturnValue({ profileId: null, rootFolderId: null, monitor: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("removeSeries authorization", () => {
  const input = { seriesIds: [1], deleteFiles: false, addImportListExclusion: false, confirmCount: 1 };

  it("checks for the admin role", async () => {
    await removeSeries(input);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    const result = await removeSeries(input);

    expect(result).toEqual({ ok: false, error: DELETE_DENIED });
    expect(mocks.deleteSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    const result = await removeSeries(input);

    expect(result).toEqual({ ok: false, error: DELETE_DENIED });
    expect(mocks.deleteSeries).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(removeSeries(input)).rejects.toThrow("database down");
    expect(mocks.deleteSeries).not.toHaveBeenCalled();
  });
});

describe("removeSeries input validation", () => {
  const valid = { seriesIds: [1, 2], deleteFiles: false, addImportListExclusion: false, confirmCount: 2 };
  const without = (key: string) => {
    const copy: Record<string, unknown> = { ...valid };
    delete copy[key];
    return copy;
  };

  const invalid: [string, unknown][] = [
    ["not an object", "series"],
    ["null", null],
    ["missing deleteFiles", without("deleteFiles")],
    ["missing addImportListExclusion", without("addImportListExclusion")],
    ["missing confirmCount", without("confirmCount")],
    ["a string boolean for deleteFiles", { ...valid, deleteFiles: "true" }],
    ["a string boolean for addImportListExclusion", { ...valid, addImportListExclusion: "false" }],
    ["the Radarr name addImportExclusion", { ...valid, addImportExclusion: false }],
    ["an extra key moveFiles", { ...valid, moveFiles: true }],
    ["an extra key qualityProfileId", { ...valid, qualityProfileId: 1 }],
    ["empty seriesIds", { ...valid, seriesIds: [], confirmCount: 0 }],
    ["a negative id", { ...valid, seriesIds: [-1, 2] }],
    ["a zero id", { ...valid, seriesIds: [0, 2] }],
    ["a string id", { ...valid, seriesIds: ["1", 2] }],
    ["a fractional id", { ...valid, seriesIds: [1.5, 2] }],
    ["a zero confirmCount", { ...valid, confirmCount: 0 }],
    ["a string confirmCount", { ...valid, confirmCount: "2" }],
    ["more than 2000 ids", { ...valid, seriesIds: Array.from({ length: 2001 }, (_, i) => i + 1), confirmCount: 2001 }],
    ["a confirmCount larger than the ids", { ...valid, confirmCount: 3 }],
    ["a confirmCount smaller than the ids", { ...valid, confirmCount: 1 }],
    ["duplicates that make the unique count differ", { ...valid, seriesIds: [1, 1, 2], confirmCount: 3 }],
    ["a confirmCount equal to the raw count but not the unique count", { ...valid, seriesIds: [1, 1], confirmCount: 2 }],
  ];

  it.each(invalid)("rejects %s without calling Sonarr", async (_name, input) => {
    const result = await removeSeries(input);

    expect(result).toEqual({ ok: false, error: "Invalid delete." });
    expect(mocks.deleteSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("uses the same 2000 limit as the client", () => {
    expect(MAX_BULK_SERIES).toBe(2000);
  });

  it("accepts exactly 2000 ids", async () => {
    const seriesIds = Array.from({ length: 2000 }, (_, i) => i + 1);
    const result = await removeSeries({ seriesIds, deleteFiles: true, addImportListExclusion: true, confirmCount: 2000 });
    expect(result).toEqual({ ok: true, deleted: 2000 });
    expect(mocks.deleteSeries).toHaveBeenCalledWith({ seriesIds, deleteFiles: true, addImportListExclusion: true });
  });

  it("does not put Zod details in the error", async () => {
    const result = await removeSeries({ ...valid, moveFiles: true });
    expect(JSON.stringify(result)).not.toMatch(/Unrecognized|received|issues|path/);
  });
});

describe("removeSeries deletes", () => {
  it("de-duplicates ids and checks the count against the unique ids", async () => {
    const result = await removeSeries({ seriesIds: [3, 1, 3, 2, 1], deleteFiles: false, addImportListExclusion: true, confirmCount: 3 });

    expect(result).toEqual({ ok: true, deleted: 3 });
    expect(mocks.deleteSeries).toHaveBeenCalledWith({ seriesIds: [3, 1, 2], deleteFiles: false, addImportListExclusion: true });
  });

  it("on success calls deleteSeries with exactly the validated fields, then refreshes", async () => {
    const result = await removeSeries({ seriesIds: [5, 6], deleteFiles: true, addImportListExclusion: false, confirmCount: 2 });

    expect(result).toEqual({ ok: true, deleted: 2 });
    expect(mocks.deleteSeries).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSeries.mock.calls[0][0]).toStrictEqual({ seriesIds: [5, 6], deleteFiles: true, addImportListExclusion: false });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("gives the friendly error when Sonarr rejects the delete, and logs only the safe message", async () => {
    mocks.deleteSeries.mockRejectedValue(new ArrRequestError("Sonarr series delete request failed: HTTP 500"));

    const result = await removeSeries({ seriesIds: [1], deleteFiles: false, addImportListExclusion: false, confirmCount: 1 });

    expect(result).toEqual({
      ok: false,
      error: "Sonarr didn't confirm the delete, so some series may already be gone. The table has been refreshed; check it before trying again.",
    });
    expect(console.error).toHaveBeenCalledWith("Series delete: Sonarr series delete request failed: HTTP 500");
    // Sonarr may have deleted some anyway, so the table is re-read even on failure.
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("says a timed-out delete may still be running, and refreshes", async () => {
    mocks.deleteSeries.mockRejectedValue(new ArrRequestError("Sonarr series delete request failed: timed out", "timeout"));

    const result = await removeSeries({ seriesIds: [1], deleteFiles: true, addImportListExclusion: false, confirmCount: 1 });

    expect(result).toEqual({
      ok: false,
      error: "Sonarr is taking a long time and may still be deleting. The table has been refreshed; check it before trying again.",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.deleteSeries.mockRejectedValue(new Error("config broken"));
    await expect(removeSeries({ seriesIds: [1], deleteFiles: false, addImportListExclusion: false, confirmCount: 1 })).rejects.toThrow(
      "config broken",
    );
  });
});

const SEARCH_DENIED = "You don't have permission to add series.";

describe("searchSeries", () => {
  beforeEach(() => {
    mocks.lookupSeries.mockResolvedValue([{ tvdbId: 200001, title: "Harbour Lights", year: 2018, network: null, overview: "", inLibrary: false, posterPath: null }]);
  });

  it("allows both admin and requester", async () => {
    mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "requester" } });
    await searchSeries({ term: "Harbour" });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
    expect(mocks.lookupSeries).toHaveBeenCalledWith("Harbour");
  });

  it("rejects a signed-out caller and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));
    expect(await searchSeries({ term: "Harbour" })).toEqual({ ok: false, error: SEARCH_DENIED });
    expect(mocks.lookupSeries).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));
    await expect(searchSeries({ term: "Harbour" })).rejects.toThrow("database down");
  });

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
    const result = await searchSeries({ term: "Harbour" });
    expect(result).toEqual({ ok: true, results: expect.any(Array) });
  });

  it("gives a friendly error and logs only the safe message when Sonarr fails", async () => {
    mocks.lookupSeries.mockRejectedValue(new ArrRequestError("Sonarr series lookup request failed: HTTP 500", "http", 500));
    expect(await searchSeries({ term: "Harbour" })).toEqual({ ok: false, error: "Sonarr couldn't complete the search. Try again." });
    expect(console.error).toHaveBeenCalledWith("Series search: Sonarr series lookup request failed: HTTP 500");
  });

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.lookupSeries.mockRejectedValue(new Error("unexpected"));
    await expect(searchSeries({ term: "Harbour" })).rejects.toThrow("unexpected");
  });
});

const ADD_DENIED = "You don't have permission to add series.";

const ADDER = { id: "u1", email: "a@example.test", name: "A", role: "requester" };
const ADMIN = { id: "u1", email: "a@example.test", name: "A", role: "admin" };
const VALID_ADD = { tvdbId: 200001 };

describe("addLibrarySeries authorization", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADDER });
    mocks.listSeriesRootFolders.mockResolvedValue([{ id: 7, path: "/invented/tv/", freeSpace: null }]);
    mocks.addSeries.mockResolvedValue({ id: 88, title: "Harbour Lights", year: 2018 });
  });

  it("allows both admin and requester", async () => {
    await addLibrarySeries(VALID_ADD);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
  });

  it("rejects a signed-out caller (401) without calling Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: false, error: ADD_DENIED });
    expect(mocks.addSeries).not.toHaveBeenCalled();
    expect(mocks.listSeriesRootFolders).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));
    await expect(addLibrarySeries(VALID_ADD)).rejects.toThrow("database down");
    expect(mocks.addSeries).not.toHaveBeenCalled();
  });
});

describe("addLibrarySeries requester input", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADDER });
  });

  // A requester sends only the TVDB id. Any other key is refused before Sonarr is read.
  it.each([
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
  ])("refuses %s with Invalid add. and never calls Sonarr", async (_name, input) => {
    expect(await addLibrarySeries(input)).toEqual({ ok: false, error: "Invalid add." });
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.listSeriesRootFolders).not.toHaveBeenCalled();
    expect(mocks.addSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("addLibrarySeries admin input", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADMIN });
  });

  // Every field the panel shows is required. Each one missing, or any extra key, is refused.
  const full = {
    tvdbId: 200001,
    qualityProfileId: 1,
    rootFolderId: 7,
    monitor: "missing",
    seriesType: "anime",
    seasonFolder: false,
    searchForMissingEpisodes: false,
  };
  const without = (key: string) => {
    const copy: Record<string, unknown> = { ...full };
    delete copy[key];
    return copy;
  };

  it.each([
    ["a missing tvdbId", without("tvdbId")],
    ["a missing qualityProfileId", without("qualityProfileId")],
    ["a missing rootFolderId", without("rootFolderId")],
    ["a missing monitor", without("monitor")],
    ["a missing seriesType", without("seriesType")],
    ["a missing seasonFolder", without("seasonFolder")],
    ["a missing searchForMissingEpisodes", without("searchForMissingEpisodes")],
    ["a monitor that is not offered", { ...full, monitor: "pilot" }],
    ["a bad series type", { ...full, seriesType: "special" }],
    ["a string seasonFolder", { ...full, seasonFolder: "false" }],
    ["a string profile id", { ...full, qualityProfileId: "1" }],
    ["a rootFolderPath", { ...full, rootFolderPath: "/invented/tv/" }],
    ["null", null],
  ])("refuses %s with Invalid add. and never calls Sonarr", async (_name, input) => {
    expect(await addLibrarySeries(input)).toEqual({ ok: false, error: "Invalid add." });
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.addSeries).not.toHaveBeenCalled();
  });
});

describe("addLibrarySeries for a requester", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADDER });
    mocks.listSeriesRootFolders.mockResolvedValue([
      { id: 7, path: "/invented/tv/", freeSpace: null },
      { id: 8, path: "/invented/other-tv/", freeSpace: null },
    ]);
    mocks.addSeries.mockResolvedValue({ id: 88, title: "Harbour Lights", year: 2018 });
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
    mocks.getSeriesAddDefaults.mockReturnValue({ profileId: null, rootFolderId: null, monitor: null });

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

  it("refuses when Sonarr has no root folders, without adding", async () => {
    mocks.listSeriesRootFolders.mockResolvedValue([]);
    expect(await addLibrarySeries(VALID_ADD)).toEqual({
      ok: false,
      error: "Sonarr has no root folders set up, so series can't be added yet.",
    });
    expect(mocks.addSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refuses when Sonarr has no quality profiles, without adding", async () => {
    mocks.listSeriesQualityProfiles.mockResolvedValue([]);
    expect(await addLibrarySeries(VALID_ADD)).toEqual({
      ok: false,
      error: "Sonarr has no quality profiles set up, so series can't be added yet.",
    });
    expect(mocks.addSeries).not.toHaveBeenCalled();
  });

  it("maps an exists error to the library message and does not refresh", async () => {
    mocks.addSeries.mockRejectedValue(new SeriesAddError("exists"));
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: false, error: "That series is already in your library." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("maps a not-found error to the Sonarr message and does not refresh", async () => {
    mocks.addSeries.mockRejectedValue(new SeriesAddError("not-found"));
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: false, error: "Sonarr couldn't find that series." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error and logs the safe message when Sonarr rejects the add", async () => {
    mocks.addSeries.mockRejectedValue(new ArrRequestError("Sonarr series add request failed: HTTP 400", "http", 400));
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: false, error: "Sonarr didn't accept the series. Try again." });
    expect(console.error).toHaveBeenCalledWith("Series add: Sonarr series add request failed: HTTP 400");
  });

  it("gives the friendly error when the root folder list cannot be fetched", async () => {
    mocks.listSeriesRootFolders.mockRejectedValue(new ArrRequestError("Sonarr root folder request failed: HTTP 500", "http", 500));
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: false, error: "Sonarr didn't accept the series. Try again." });
    expect(mocks.addSeries).not.toHaveBeenCalled();
  });

  it("says the series may still have been added when the add times out, and logs the safe message", async () => {
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

  it("does not claim the series may have been added when the lookup before the add timed out", async () => {
    mocks.addSeries.mockRejectedValue(new ArrRequestError("Sonarr series lookup request failed: timed out", "timeout"));
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: false, error: "Sonarr didn't accept the series. Try again." });
  });

  it("does not claim the series may have been added when only the folder read timed out", async () => {
    mocks.listSeriesRootFolders.mockRejectedValue(new ArrRequestError("Sonarr root folder request failed: timed out", "timeout"));
    expect(await addLibrarySeries(VALID_ADD)).toEqual({ ok: false, error: "Sonarr didn't accept the series. Try again." });
  });

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.addSeries.mockRejectedValue(new Error("unexpected"));
    await expect(addLibrarySeries(VALID_ADD)).rejects.toThrow("unexpected");
  });
});

describe("addLibrarySeries for an admin", () => {
  beforeEach(() => {
    mocks.requireRole.mockResolvedValue({ user: ADMIN });
    mocks.listSeriesRootFolders.mockResolvedValue([
      { id: 7, path: "/invented/tv/", freeSpace: null },
      { id: 8, path: "/invented/other-tv/", freeSpace: null },
    ]);
    mocks.addSeries.mockResolvedValue({ id: 89, title: "Harbour Lights", year: 2018 });
  });

  const chosen = {
    tvdbId: 200001,
    qualityProfileId: 1,
    rootFolderId: 8,
    monitor: "missing",
    seriesType: "anime",
    seasonFolder: false,
    searchForMissingEpisodes: false,
  };

  it("adds with every chosen value and returns the new id", async () => {
    mocks.getSeriesAddDefaults.mockReturnValue({ profileId: 2, rootFolderId: 7, monitor: "future" });
    expect(await addLibrarySeries(chosen)).toEqual({ ok: true, id: 89, title: "Harbour Lights", year: 2018 });
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
    await addLibrarySeries({ ...chosen, qualityProfileId: 1, rootFolderId: 7, monitor: "all" });
    expect(mocks.addSeries.mock.calls[0][0]).toMatchObject({ qualityProfileId: 1, rootFolderPath: "/invented/tv/", monitor: "all" });
  });

  it("refuses an unknown quality profile without adding", async () => {
    expect(await addLibrarySeries({ ...chosen, qualityProfileId: 99 })).toEqual({
      ok: false,
      error: "That quality profile no longer exists.",
    });
    expect(mocks.addSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refuses an unknown root folder without adding", async () => {
    expect(await addLibrarySeries({ ...chosen, rootFolderId: 99 })).toEqual({
      ok: false,
      error: "That root folder no longer exists.",
    });
    expect(mocks.addSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("searchLibrarySeries", () => {
  const SEARCH_DENIED = "You don't have permission to search for series.";

  it("allows both admin and requester", async () => {
    await searchLibrarySeries({ seriesIds: [1] });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
  });

  it("rejects a signed-out caller and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));
    const result = await searchLibrarySeries({ seriesIds: [1] });
    expect(result).toEqual({ ok: false, error: SEARCH_DENIED });
    expect(mocks.searchSeriesReleases).not.toHaveBeenCalled();
  });

  it("rethrows a non-authorization failure from the role check", async () => {
    mocks.requireRole.mockRejectedValue(new Error("db down"));
    await expect(searchLibrarySeries({ seriesIds: [1] })).rejects.toThrow("db down");
    expect(mocks.searchSeriesReleases).not.toHaveBeenCalled();
  });

  it.each([
    ["no ids", { seriesIds: [] }],
    ["too many ids", { seriesIds: Array.from({ length: MAX_SEARCH_SERIES + 1 }, (_, i) => i + 1) }],
    ["a zero id", { seriesIds: [0] }],
    ["a fractional id", { seriesIds: [1.5] }],
    ["a string id", { seriesIds: ["1"] }],
    ["an extra key", { seriesIds: [1], monitored: true }],
    ["a missing list", {}],
    ["null", null],
  ])("rejects %s without calling Sonarr", async (_name, input) => {
    const result = await searchLibrarySeries(input);
    expect(result).toEqual({ ok: false, error: "Invalid search." });
    expect(mocks.searchSeriesReleases).not.toHaveBeenCalled();
  });

  it("accepts exactly MAX_SEARCH_SERIES ids", async () => {
    const result = await searchLibrarySeries({ seriesIds: Array.from({ length: MAX_SEARCH_SERIES }, (_, i) => i + 1) });
    expect(result).toEqual({ ok: true, searched: MAX_SEARCH_SERIES });
  });

  it("sends each id once, in order, and reports the unique count", async () => {
    const result = await searchLibrarySeries({ seriesIds: [4, 5, 4] });
    expect(mocks.searchSeriesReleases.mock.calls).toEqual([[4], [5]]);
    expect(result).toEqual({ ok: true, searched: 2 });
  });

  it("does not re-render the page, since Sonarr only queues the search", async () => {
    await searchLibrarySeries({ seriesIds: [1] });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the timeout message when the first search times out", async () => {
    mocks.searchSeriesReleases.mockRejectedValue(new ArrRequestError("timed out", "timeout"));
    const result = await searchLibrarySeries({ seriesIds: [1, 2] });
    expect(result).toEqual({
      ok: false,
      error: "Sonarr took too long to answer. The search may still have started, so check Sonarr before trying again.",
    });
    expect(mocks.searchSeriesReleases).toHaveBeenCalledTimes(1);
  });

  it("gives the try-again message when the first search fails without a timeout, and logs only the safe message", async () => {
    mocks.searchSeriesReleases.mockRejectedValue(new ArrRequestError("Sonarr series search command request failed: HTTP 500"));
    const result = await searchLibrarySeries({ seriesIds: [1, 2] });
    expect(result).toEqual({ ok: false, error: "Sonarr didn't start the search. Try again." });
    expect(console.error).toHaveBeenCalledWith("Series search now: Sonarr series search command request failed: HTTP 500");
    expect(mocks.searchSeriesReleases).toHaveBeenCalledTimes(1);
  });

  it("reports how far it got when a later search fails, and stops before the rest", async () => {
    mocks.searchSeriesReleases
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ArrRequestError("Sonarr series search command request failed: network error"));
    const result = await searchLibrarySeries({ seriesIds: [1, 2, 3, 4] });
    expect(result).toEqual({
      ok: false,
      error: "Sonarr started searches for 2 of 4 series, then the next one failed. Those are now deselected; check Sonarr before searching the rest.",
      startedIds: [1, 2],
    });
    expect(mocks.searchSeriesReleases.mock.calls).toEqual([[1], [2], [3]]);
  });

  it("says a later search may have started when it times out", async () => {
    mocks.searchSeriesReleases
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ArrRequestError("timed out", "timeout"));
    const result = await searchLibrarySeries({ seriesIds: [7, 8, 9] });
    expect(result).toEqual({
      ok: false,
      error:
        "Sonarr started searches for 1 of 3 series, then took too long on the next one, which may also have started. Those are now deselected; check Sonarr before searching the rest.",
      startedIds: [7],
    });
    expect(mocks.searchSeriesReleases.mock.calls).toEqual([[7], [8]]);
  });

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.searchSeriesReleases.mockRejectedValue(new Error("config broken"));
    await expect(searchLibrarySeries({ seriesIds: [1] })).rejects.toThrow("config broken");
  });
});

describe("refreshLibrarySeries", () => {
  const REFRESH_DENIED = "You don't have permission to refresh series.";

  it("checks for the admin role only", async () => {
    await refreshLibrarySeries({ seriesIds: [1] });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));
    const result = await refreshLibrarySeries({ seriesIds: [1] });
    expect(result).toEqual({ ok: false, error: REFRESH_DENIED });
    expect(mocks.refreshSeries).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));
    const result = await refreshLibrarySeries({ seriesIds: [1] });
    expect(result).toEqual({ ok: false, error: REFRESH_DENIED });
    expect(mocks.refreshSeries).not.toHaveBeenCalled();
  });

  it("rethrows a non-authorization failure from the role check", async () => {
    mocks.requireRole.mockRejectedValue(new Error("db down"));
    await expect(refreshLibrarySeries({ seriesIds: [1] })).rejects.toThrow("db down");
    expect(mocks.refreshSeries).not.toHaveBeenCalled();
  });

  it.each([
    ["no ids", { seriesIds: [] }],
    ["too many ids", { seriesIds: Array.from({ length: MAX_REFRESH_SERIES + 1 }, (_, i) => i + 1) }],
    ["a zero id", { seriesIds: [0] }],
    ["a fractional id", { seriesIds: [1.5] }],
    ["a string id", { seriesIds: ["1"] }],
    ["an extra key", { seriesIds: [1], monitored: true }],
    ["a missing list", {}],
    ["null", null],
  ])("rejects %s without calling Sonarr", async (_name, input) => {
    const result = await refreshLibrarySeries(input);
    expect(result).toEqual({ ok: false, error: "Invalid refresh." });
    expect(mocks.refreshSeries).not.toHaveBeenCalled();
  });

  it("accepts exactly MAX_REFRESH_SERIES ids", async () => {
    const seriesIds = Array.from({ length: MAX_REFRESH_SERIES }, (_, i) => i + 1);
    const result = await refreshLibrarySeries({ seriesIds });
    expect(result).toEqual({ ok: true, refreshed: MAX_REFRESH_SERIES });
  });

  it("passes the deduplicated list in one call and reports the unique count", async () => {
    const result = await refreshLibrarySeries({ seriesIds: [4, 5, 4, 3] });
    expect(mocks.refreshSeries.mock.calls).toEqual([[[4, 5, 3]]]);
    expect(result).toEqual({ ok: true, refreshed: 3 });
  });

  it("does not re-render the page, since Sonarr only queues the refresh", async () => {
    await refreshLibrarySeries({ seriesIds: [1] });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the timeout message after a timeout", async () => {
    mocks.refreshSeries.mockRejectedValue(new ArrRequestError("timed out", "timeout"));
    const result = await refreshLibrarySeries({ seriesIds: [1] });
    expect(result).toEqual({
      ok: false,
      error: "Sonarr took too long to answer. The refresh may still have started, so check Sonarr before trying again.",
    });
  });

  it("gives a friendly error and logs only the safe message when Sonarr fails", async () => {
    mocks.refreshSeries.mockRejectedValue(new ArrRequestError("Sonarr series refresh command request failed: HTTP 500"));
    const result = await refreshLibrarySeries({ seriesIds: [1] });
    expect(result).toEqual({ ok: false, error: "Sonarr didn't start the refresh. Try again." });
    expect(console.error).toHaveBeenCalledWith("Series refresh: Sonarr series refresh command request failed: HTTP 500");
  });

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.refreshSeries.mockRejectedValue(new Error("config broken"));
    await expect(refreshLibrarySeries({ seriesIds: [1] })).rejects.toThrow("config broken");
  });
});

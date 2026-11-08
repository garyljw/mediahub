import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ArrRequestError } from "@/server/arr/request";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  setEpisodeMonitored: vi.fn(),
  setSeasonMonitored: vi.fn(),
  searchSeason: vi.fn(),
  searchEpisode: vi.fn(),
  refresh: vi.fn(),
  searchSeriesReleases: vi.fn(),
  grabSeriesRelease: vi.fn(),
  deleteSeries: vi.fn(),
  editSeries: vi.fn(),
  listSeriesQualityProfiles: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/server/arr/series", () => ({
  deleteSeries: mocks.deleteSeries,
  editSeries: mocks.editSeries,
  listSeriesQualityProfiles: mocks.listSeriesQualityProfiles,
}));

// redirect throws in Next, so the mock does too. A test can then tell a redirect from a returned result.
vi.mock("next/navigation", () => ({
  RedirectType: { push: "push", replace: "replace" },
  redirect: (path: string, type?: string) => {
    mocks.redirect(path, type);
    throw new Error(`NEXT_REDIRECT ${path}`);
  },
}));

// The series-releases module is mocked, so the real grab rule (grabWasRefused) and ReleaseGrabError come from releases.ts.
vi.mock("@/server/arr/series-releases", () => ({
  searchSeriesReleases: mocks.searchSeriesReleases,
  grabSeriesRelease: mocks.grabSeriesRelease,
}));

// AuthzError must be a real class: the actions check `instanceof AuthzError`.
vi.mock("@/server/authz", () => {
  class AuthzError extends Error {
    constructor(readonly status: 401 | 403) {
      super(status === 401 ? "unauthorized" : "forbidden");
      this.name = "AuthzError";
    }
  }
  return { AuthzError, requireRole: mocks.requireRole };
});

// SeasonNotFoundError must be a real class: the season action checks `instanceof SeasonNotFoundError`.
vi.mock("@/server/arr/episodes", () => {
  class SeasonNotFoundError extends Error {
    constructor() {
      super("Season not found");
      this.name = "SeasonNotFoundError";
    }
  }
  return {
    SeasonNotFoundError,
    setEpisodeMonitored: mocks.setEpisodeMonitored,
    setSeasonMonitored: mocks.setSeasonMonitored,
    searchSeason: mocks.searchSeason,
    searchEpisode: mocks.searchEpisode,
  };
});

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import { AuthzError } from "@/server/authz";
import { SeasonNotFoundError } from "@/server/arr/episodes";
import {
  deleteSeriesItem,
  findSeriesReleases,
  grabSeriesRelease,
  searchEpisodeNow,
  searchSeasonNow,
  setEpisodeMonitoring,
  setSeasonMonitoring,
  updateSeriesItem,
} from "./actions";
import { ReleaseGrabError } from "@/server/arr/releases";

const MONITOR_DENIED = "You don't have permission to change monitoring.";
const SEARCH_DENIED = "You don't have permission to search for episodes.";
const PICK_DENIED = "You don't have permission to pick releases.";
const DELETE_DENIED = "You don't have permission to delete series.";
const DELETE_INVALID = "Invalid delete.";
const SERIES_EDIT_DENIED = "You don't have permission to edit series.";
const SERIES_EDIT_INVALID = "Invalid edit.";

const release = { token: "00000000-0000-4000-8000-000000000002" };
const validDelete = { seriesId: 4, deleteFiles: false, addImportListExclusion: false };
const seriesEdit = { seriesId: 10, monitored: true };
const SERIES_PROFILES = [
  { id: 1, name: "HD-1080p" },
  { id: 2, name: "Any" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.setEpisodeMonitored.mockResolvedValue(undefined);
  mocks.setSeasonMonitored.mockResolvedValue(undefined);
  mocks.searchSeason.mockResolvedValue(undefined);
  mocks.searchEpisode.mockResolvedValue(undefined);
  mocks.searchSeriesReleases.mockResolvedValue({ rows: [], totals: { all: 0, usenet: 0, torrent: 0 } });
  mocks.grabSeriesRelease.mockResolvedValue({ title: "Breaking.Bad.S02.1080p" });
  mocks.deleteSeries.mockResolvedValue(undefined);
  mocks.editSeries.mockResolvedValue(undefined);
  mocks.listSeriesQualityProfiles.mockResolvedValue([
    { id: 1, name: "HD-1080p" },
    { id: 2, name: "Any" },
  ]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** deleteSeriesItem succeeds by redirecting, which throws in the mock. Swallow only that, and rethrow anything else. */
async function settle(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT ")) return undefined;
    throw error;
  }
}

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
    { name: "setEpisodeMonitoring", call: () => setEpisodeMonitoring({ episodeId: 1, monitored: true }), roles: ["admin"], denied: MONITOR_DENIED, upstream: [mocks.setEpisodeMonitored] },
    { name: "setSeasonMonitoring", call: () => setSeasonMonitoring({ seriesId: 1, seasonNumber: 2, monitored: true }), roles: ["admin"], denied: MONITOR_DENIED, upstream: [mocks.setSeasonMonitored] },
    { name: "searchSeasonNow", call: () => searchSeasonNow({ seriesId: 1, seasonNumber: 2 }), roles: ["admin", "requester"], denied: SEARCH_DENIED, upstream: [mocks.searchSeason] },
    { name: "searchEpisodeNow", call: () => searchEpisodeNow({ episodeId: 3 }), roles: ["admin", "requester"], denied: SEARCH_DENIED, upstream: [mocks.searchEpisode] },
    { name: "findSeriesReleases", call: () => findSeriesReleases({ seriesId: 10, seasonNumber: 2 }), roles: ["admin"], denied: PICK_DENIED, upstream: [mocks.searchSeriesReleases] },
    { name: "grabSeriesRelease", call: () => grabSeriesRelease({ token: release.token }), roles: ["admin"], denied: PICK_DENIED, upstream: [mocks.grabSeriesRelease] },
    { name: "deleteSeriesItem", call: () => deleteSeriesItem(validDelete), roles: ["admin"], denied: DELETE_DENIED, upstream: [mocks.deleteSeries, mocks.redirect] },
    { name: "updateSeriesItem", call: () => updateSeriesItem(seriesEdit), roles: ["admin"], denied: SERIES_EDIT_DENIED, upstream: [mocks.editSeries, mocks.listSeriesQualityProfiles] },
  ];

  it.each(rows)("$name asks for $roles", async ({ call, roles }) => {
    await settle(call());
    expect(mocks.requireRole).toHaveBeenCalledWith(...roles);
  });

  it.each(rows)("$name refuses a denied caller, and calls no upstream function", async ({ call, denied, upstream }) => {
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

describe("input validation", () => {
  const invalidEpisodeMonitor: [string, unknown][] = [
    ["not an object", "episode"],
    ["null", null],
    ["a missing episode id", { monitored: true }],
    ["a negative id", { episodeId: -1, monitored: true }],
    ["a zero id", { episodeId: 0, monitored: true }],
    ["a string id", { episodeId: "1", monitored: true }],
    ["a fractional id", { episodeId: 1.5, monitored: true }],
    ["a missing flag", { episodeId: 1 }],
    ["a non-boolean flag", { episodeId: 1, monitored: "yes" }],
    ["an unknown key", { episodeId: 1, monitored: true, moveFiles: true }],
    ["a seriesIds key", { seriesIds: [1], monitored: true }],
  ];

  it.each(invalidEpisodeMonitor)("rejects an episode monitor with %s without calling Sonarr", async (_name, input) => {
    expect(await setEpisodeMonitoring(input)).toEqual({ ok: false, error: "Invalid change." });
    expect(mocks.setEpisodeMonitored).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  const invalidSeasonMonitor: [string, unknown][] = [
    ["not an object", 2],
    ["a negative series id", { seriesId: -1, seasonNumber: 2, monitored: true }],
    ["a string series id", { seriesId: "1", seasonNumber: 2, monitored: true }],
    ["a negative season number", { seriesId: 1, seasonNumber: -1, monitored: true }],
    ["a fractional season number", { seasonNumber: 1.5, seriesId: 1, monitored: true }],
    ["a missing season number", { seriesId: 1, monitored: true }],
    ["a non-boolean flag", { seriesId: 1, seasonNumber: 2, monitored: 1 }],
    ["an unknown key", { seriesId: 1, seasonNumber: 2, monitored: true, moveFiles: true }],
    ["an episodeId key", { episodeId: 1, monitored: true }],
  ];

  it.each(invalidSeasonMonitor)("rejects a season monitor with %s without calling Sonarr", async (_name, input) => {
    expect(await setSeasonMonitoring(input)).toEqual({ ok: false, error: "Invalid change." });
    expect(mocks.setSeasonMonitored).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("accepts season 0 (Specials)", async () => {
    expect(await setSeasonMonitoring({ seriesId: 1, seasonNumber: 0, monitored: false })).toEqual({ ok: true });
    expect(mocks.setSeasonMonitored).toHaveBeenCalledWith(1, 0, false, expect.any(Function));
  });

  const invalidSeasonSearch: [string, unknown][] = [
    ["a negative season number", { seriesId: 1, seasonNumber: -1 }],
    ["a missing series id", { seasonNumber: 2 }],
    ["a string season number", { seriesId: 1, seasonNumber: "2" }],
    ["an unknown key", { seriesId: 1, seasonNumber: 2, name: "EpisodeSearch" }],
  ];

  it.each(invalidSeasonSearch)("rejects a season search with %s without calling Sonarr", async (_name, input) => {
    expect(await searchSeasonNow(input)).toEqual({ ok: false, error: "Invalid search." });
    expect(mocks.searchSeason).not.toHaveBeenCalled();
  });

  const invalidEpisodeSearch: [string, unknown][] = [
    ["a negative id", { episodeId: -4 }],
    ["a missing id", {}],
    ["an unknown key", { episodeId: 1, seriesId: 1 }],
    ["an array of ids", { episodeIds: [1] }],
  ];

  it.each(invalidEpisodeSearch)("rejects an episode search with %s without calling Sonarr", async (_name, input) => {
    expect(await searchEpisodeNow(input)).toEqual({ ok: false, error: "Invalid search." });
    expect(mocks.searchEpisode).not.toHaveBeenCalled();
  });
});

describe("setEpisodeMonitoring success and failure", () => {
  it("calls setEpisodeMonitored with exactly the validated values, then refreshes", async () => {
    expect(await setEpisodeMonitoring({ episodeId: 42, monitored: false })).toEqual({ ok: true });
    expect(mocks.setEpisodeMonitored).toHaveBeenCalledWith(42, false);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("says Sonarr didn't accept a 4xx, logs only the safe message, and does not refresh", async () => {
    mocks.setEpisodeMonitored.mockRejectedValue(new ArrRequestError("Sonarr episode monitor request failed: HTTP 400", "http", 400));

    expect(await setEpisodeMonitoring({ episodeId: 42, monitored: true })).toEqual({ ok: false, error: "Sonarr didn't accept the change. Try again." });
    expect(console.error).toHaveBeenCalledWith("Episode monitor: Sonarr episode monitor request failed: HTTP 400");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says the change may have been saved after a 5xx, and does not refresh", async () => {
    mocks.setEpisodeMonitored.mockRejectedValue(new ArrRequestError("Sonarr episode monitor request failed: HTTP 502", "http", 502));

    expect(await setEpisodeMonitoring({ episodeId: 42, monitored: true })).toEqual({ ok: false, error: "Sonarr didn't confirm the change. It may still have been saved, so reload the page to check." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says a timed-out change may have been saved, and does not refresh", async () => {
    mocks.setEpisodeMonitored.mockRejectedValue(new ArrRequestError("Sonarr episode monitor request failed: timed out", "timeout"));

    const result = await setEpisodeMonitoring({ episodeId: 42, monitored: true });

    expect(result).toEqual({ ok: false, error: "Sonarr took too long to answer. The change may still have been saved, so reload the page to check." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("setSeasonMonitoring success and failure", () => {
  it("calls setSeasonMonitored with exactly the validated values, then refreshes", async () => {
    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({ ok: true });
    expect(mocks.setSeasonMonitored).toHaveBeenCalledWith(5, 3, true, expect.any(Function));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("says the season no longer exists when Sonarr has no such season, and does not refresh", async () => {
    mocks.setSeasonMonitored.mockRejectedValue(new SeasonNotFoundError());

    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({ ok: false, error: "That season no longer exists." });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  /** Makes setSeasonMonitored fail after its write was sent, as a failure on the PUT would. */
  function failAfterSend(error: ArrRequestError) {
    mocks.setSeasonMonitored.mockImplementation(async (_id: number, _season: number, _monitored: boolean, onSend: () => void) => {
      onSend();
      throw error;
    });
  }

  it("says Sonarr didn't accept a 4xx on the write, and logs only the safe message", async () => {
    failAfterSend(new ArrRequestError("Sonarr series update request failed: HTTP 400", "http", 400));

    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({ ok: false, error: "Sonarr didn't accept the change. Try again." });
    expect(console.error).toHaveBeenCalledWith("Season monitor: Sonarr series update request failed: HTTP 400");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  // A 5xx after the write was sent must not be read as "nothing changed": only the read's failures mean that.
  it.each([
    ["a dropped connection", new ArrRequestError("Sonarr series update request failed: network error", "network")],
    ["a 5xx", new ArrRequestError("Sonarr series update request failed: HTTP 500", "http", 500)],
  ])("says the change may have been saved after %s on the write", async (_name, error) => {
    failAfterSend(error);

    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({ ok: false, error: "Sonarr didn't confirm the change. It may still have been saved, so reload the page to check." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says a timeout on the write may have saved the change, and does not refresh", async () => {
    failAfterSend(new ArrRequestError("Sonarr series update request failed: timed out", "timeout"));

    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({ ok: false, error: "Sonarr took too long to answer. The change may still have been saved, so reload the page to check." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["timed out", new ArrRequestError("Sonarr series request failed: timed out", "timeout")],
    ["answered 500", new ArrRequestError("Sonarr series request failed: HTTP 500", "http", 500)],
  ])("says nothing changed when the read %s before anything was written", async (_name, error) => {
    mocks.setSeasonMonitored.mockRejectedValue(error);

    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({ ok: false, error: "Couldn't load the series from Sonarr, so nothing changed. Try again." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("season and episode searches", () => {
  const searches = [
    { action: "searchSeasonNow", call: () => searchSeasonNow({ seriesId: 5, seasonNumber: 2 }), mock: mocks.searchSeason, args: [5, 2], http500: new ArrRequestError("Sonarr season search command request failed: HTTP 500", "http", 500), logLine: "Season search: Sonarr season search command request failed: HTTP 500", timeout: new ArrRequestError("Sonarr season search command request failed: timed out", "timeout") },
    { action: "searchEpisodeNow", call: () => searchEpisodeNow({ episodeId: 9 }), mock: mocks.searchEpisode, args: [9], http500: new ArrRequestError("Sonarr episode search command request failed: HTTP 500", "http", 500), logLine: "Episode search: Sonarr episode search command request failed: HTTP 500", timeout: new ArrRequestError("Sonarr episode search command request failed: timed out", "timeout") },
  ];

  it.each(searches)("$action calls Sonarr with exactly the validated values, and does not refresh", async ({ call, mock, args }) => {
    expect(await call()).toEqual({ ok: true });
    expect(mock).toHaveBeenCalledWith(...args);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(searches)("$action says Sonarr didn't start the search on a 500, and logs only the safe message", async ({ call, mock, http500, logLine }) => {
    mock.mockRejectedValue(http500);

    expect(await call()).toEqual({ ok: false, error: "Sonarr didn't start the search. Try again." });
    expect(console.error).toHaveBeenCalledWith(logLine);
  });

  it.each(searches)("$action says a timed-out search may have started, so the user checks before retrying", async ({ call, mock, timeout }) => {
    mock.mockRejectedValue(timeout);

    expect(await call()).toEqual({ ok: false, error: "Sonarr took too long to answer. The search may still have started, so check Sonarr before trying again." });
  });
});

describe("findSeriesReleases and grabSeriesRelease", () => {
  describe("findSeriesReleases input", () => {
    it.each([
      ["a series id alone", { seriesId: 10 }],
      ["a season and an episode together", { seriesId: 10, seasonNumber: 2, episodeId: 202 }],
      ["an extra key on a season search", { seriesId: 10, seasonNumber: 2, guid: "x" }],
      ["an extra key on an episode search", { episodeId: 202, extra: 1 }],
      ["a negative series id", { seriesId: -1, seasonNumber: 2 }],
      ["a series id on an episode search", { seriesId: 10, episodeId: 202 }],
      ["a negative season", { seriesId: 10, seasonNumber: -1 }],
      ["a negative episode id", { episodeId: -202 }],
      ["a string season", { seriesId: 10, seasonNumber: "2" }],
      ["a fractional episode id", { episodeId: 2.5 }],
      ["a missing series id", { seasonNumber: 2 }],
      ["null", null],
    ])("rejects %s without calling Sonarr", async (_name, input) => {
      expect(await findSeriesReleases(input)).toEqual({ ok: false, error: "Invalid search." });
      expect(mocks.searchSeriesReleases).not.toHaveBeenCalled();
    });

    it("searches for a season with its series and season number only", async () => {
      await findSeriesReleases({ seriesId: 10, seasonNumber: 0 });
      expect(mocks.searchSeriesReleases).toHaveBeenCalledWith({ seriesId: 10, seasonNumber: 0 });
    });

    it("searches for an episode with its series and episode id", async () => {
      await findSeriesReleases({ episodeId: 202 });
      expect(mocks.searchSeriesReleases).toHaveBeenCalledWith({ episodeId: 202 });
    });

    it("returns the rows and totals on success, and does not re-render the page", async () => {
      const rows = [{ token: release.token, title: "Breaking.Bad.S02" }];
      const totals = { all: 3, usenet: 2, torrent: 1 };
      mocks.searchSeriesReleases.mockResolvedValue({ rows, totals });

      const result = await findSeriesReleases({ seriesId: 10, seasonNumber: 2 });

      expect(result).toEqual({ ok: true, releases: rows, totals });
      expect(mocks.refresh).not.toHaveBeenCalled();
    });

    it("says it timed out, and logs only the safe message", async () => {
      mocks.searchSeriesReleases.mockRejectedValue(new ArrRequestError("Sonarr release search request failed: timed out", "timeout"));
      expect(await findSeriesReleases({ seriesId: 10, seasonNumber: 2 })).toEqual({ ok: false, error: "Sonarr took too long searching the indexers. Try again in a moment." });
      expect(console.error).toHaveBeenCalledWith("Release search: Sonarr release search request failed: timed out");
    });

    it("says the season or episode is gone on a 404", async () => {
      mocks.searchSeriesReleases.mockRejectedValue(new ArrRequestError("Sonarr release search request failed: HTTP 404", "http", 404));
      expect(await findSeriesReleases({ episodeId: 202 })).toEqual({ ok: false, error: "That season or episode is no longer in Sonarr. Close this and reload the page." });
    });

    it("gives the generic message for other Sonarr failures", async () => {
      mocks.searchSeriesReleases.mockRejectedValue(new ArrRequestError("Sonarr release search request failed: HTTP 400", "http", 400));
      expect(await findSeriesReleases({ seriesId: 10, seasonNumber: 2 })).toEqual({ ok: false, error: "Sonarr couldn't search the indexers. Try again." });
    });
  });

  describe("grabSeriesRelease input and results", () => {
    it.each([
      ["a missing token", {}],
      ["a token that is not a UUID", { token: "not-a-uuid" }],
      ["a number token", { token: 12 }],
      ["an extra key", { token: release.token, guid: "https://indexer.test/details/1" }],
      ["an extra episode id", { token: release.token, episodeId: 202 }],
      ["null", null],
    ])("rejects %s without calling Sonarr", async (_name, input) => {
      expect(await grabSeriesRelease(input)).toEqual({ ok: false, error: "Invalid grab." });
      expect(mocks.grabSeriesRelease).not.toHaveBeenCalled();
    });

    it("returns the title on success, and does not re-render the page", async () => {
      mocks.grabSeriesRelease.mockResolvedValue({ title: "Breaking.Bad.S02" });

      const result = await grabSeriesRelease({ token: release.token });

      expect(mocks.grabSeriesRelease).toHaveBeenCalledWith(release.token);
      expect(result).toEqual({ ok: true, title: "Breaking.Bad.S02" });
      expect(mocks.refresh).not.toHaveBeenCalled();
    });

    it("says the result can no longer be used on a token miss or an expired release", async () => {
      mocks.grabSeriesRelease.mockRejectedValue(new ReleaseGrabError("expired"));
      expect(await grabSeriesRelease({ token: release.token })).toEqual({ ok: false, error: "Sonarr can no longer use that result: it may have expired, or Sonarr couldn't match it to episodes. Search again or pick another one." });
    });

    it("warns about a possible grab after a timeout", async () => {
      mocks.grabSeriesRelease.mockRejectedValue(new ArrRequestError("Sonarr release grab request failed: timed out", "timeout"));
      expect(await grabSeriesRelease({ token: release.token })).toEqual({ ok: false, error: "Sonarr took too long to answer. The release may still have been grabbed, so check the queue before trying again." });
      expect(console.error).toHaveBeenCalledWith("Release grab: Sonarr release grab request failed: timed out");
    });

    it("says the indexer did not hand over the release on a 409", async () => {
      mocks.grabSeriesRelease.mockRejectedValue(new ArrRequestError("Sonarr release grab request failed: HTTP 409", "http", 409));
      expect(await grabSeriesRelease({ token: release.token })).toEqual({ ok: false, error: "The indexer didn't hand over that release. Try again, or pick another one." });
    });

    it("gives the plain refusal message for other 4xx errors", async () => {
      mocks.grabSeriesRelease.mockRejectedValue(new ArrRequestError("Sonarr release grab request failed: HTTP 400", "http", 400));
      expect(await grabSeriesRelease({ token: release.token })).toEqual({ ok: false, error: "Sonarr didn't grab the release. Try again." });
    });

    it("warns about a possible grab after a 5xx, since Sonarr may have sent the release first", async () => {
      mocks.grabSeriesRelease.mockRejectedValue(new ArrRequestError("Sonarr release grab request failed: HTTP 500", "http", 500));
      expect(await grabSeriesRelease({ token: release.token })).toEqual({ ok: false, error: "Sonarr didn't confirm the grab. It may still have been sent, so check the queue before trying again." });
    });
  });
});

describe("deleteSeriesItem", () => {
  it("refuses an extra key, a non-positive id, or a missing boolean", async () => {
    expect(await deleteSeriesItem({ ...validDelete, moveFiles: true })).toEqual({ ok: false, error: DELETE_INVALID });
    expect(await deleteSeriesItem({ ...validDelete, seriesId: 0 })).toEqual({ ok: false, error: DELETE_INVALID });
    expect(await deleteSeriesItem({ seriesId: 4, addImportListExclusion: false })).toEqual({
      ok: false,
      error: DELETE_INVALID,
    });
    expect(mocks.deleteSeries).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("sends exactly one series id with both booleans, and redirects to Home", async () => {
    await expect(
      deleteSeriesItem({ seriesId: 4, deleteFiles: true, addImportListExclusion: true }),
    ).rejects.toThrow("NEXT_REDIRECT /");

    expect(mocks.deleteSeries).toHaveBeenCalledWith({ seriesIds: [4], deleteFiles: true, addImportListExclusion: true });
    expect(mocks.redirect).toHaveBeenCalledWith("/", "replace");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says Sonarr may still be deleting after a timeout", async () => {
    mocks.deleteSeries.mockRejectedValue(new ArrRequestError("Sonarr series delete request failed: timed out", "timeout"));

    const result = await deleteSeriesItem(validDelete);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("may still be deleting");
    expect(result.error).toContain("refreshed");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("says Sonarr didn't confirm for any other failure", async () => {
    mocks.deleteSeries.mockRejectedValue(new ArrRequestError("Sonarr series delete request failed: HTTP 504", "http", 504));

    const result = await deleteSeriesItem(validDelete);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("didn't confirm");
    expect(result.error).toContain("refreshed");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("updateSeriesItem input validation", () => {
  const invalid: [string, unknown][] = [
    ["not an object", "series"],
    ["null", null],
    ["no series id", { monitored: true }],
    ["a zero id", { seriesId: 0, monitored: true }],
    ["a negative id", { seriesId: -1, monitored: true }],
    ["a string id", { seriesId: "10", monitored: true }],
    ["a fractional id", { seriesId: 10.5, monitored: true }],
    ["an empty edit", { seriesId: 10 }],
    ["an unknown key", { seriesId: 10, monitored: true, deleteFiles: true }],
    ["a root folder path", { seriesId: 10, monitored: true, rootFolderPath: "/invented/tv/" }],
    ["a moveFiles flag", { seriesId: 10, monitored: true, moveFiles: true }],
    ["a seriesIds list", { seriesIds: [10], monitored: true }],
    ["a string profile id", { seriesId: 10, qualityProfileId: "2" }],
    ["a zero profile id", { seriesId: 10, qualityProfileId: 0 }],
    ["a non-boolean monitored", { seriesId: 10, monitored: "yes" }],
    ["a series type with the wrong case", { seriesId: 10, seriesType: "Anime" }],
    ["a series type the form does not offer", { seriesId: 10, seriesType: "weird" }],
    ["a null series type", { seriesId: 10, seriesType: null }],
    ["a non-boolean season folder flag", { seriesId: 10, seasonFolder: "yes" }],
    ["a new-season value the form does not offer", { seriesId: 10, monitorNewItems: "future" }],
    ["a null new-season value", { seriesId: 10, monitorNewItems: null }],
  ];

  it.each(invalid)("rejects %s without calling Sonarr", async (_name, input) => {
    expect(await updateSeriesItem(input)).toEqual({ ok: false, error: SERIES_EDIT_INVALID });
    expect(mocks.editSeries).not.toHaveBeenCalled();
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not put Zod details in the error", async () => {
    const result = await updateSeriesItem({ seriesId: -1, monitored: true });
    expect(JSON.stringify(result)).not.toMatch(/Too small|received|issues|path/);
  });
});

describe("updateSeriesItem edits", () => {
  it("sends the id and a monitored flag, without checking profiles, then refreshes", async () => {
    expect(await updateSeriesItem({ seriesId: 10, monitored: false })).toEqual({ ok: true });

    expect(mocks.editSeries).toHaveBeenCalledWith({ seriesId: 10, monitored: false });
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("checks that a chosen quality profile still exists, then sends it", async () => {
    mocks.listSeriesQualityProfiles.mockResolvedValue(SERIES_PROFILES);

    expect(await updateSeriesItem({ seriesId: 10, qualityProfileId: 2 })).toEqual({ ok: true });

    expect(mocks.listSeriesQualityProfiles).toHaveBeenCalledTimes(1);
    expect(mocks.editSeries).toHaveBeenCalledWith({ seriesId: 10, qualityProfileId: 2 });
  });

  it("sends a false season folder flag, which is a real change", async () => {
    expect(await updateSeriesItem({ seriesId: 10, seasonFolder: false })).toEqual({ ok: true });

    expect(mocks.editSeries).toHaveBeenCalledWith({ seriesId: 10, seasonFolder: false });
  });

  it.each([
    ["seriesType", "standard"],
    ["seriesType", "daily"],
    ["seriesType", "anime"],
    ["monitorNewItems", "all"],
    ["monitorNewItems", "none"],
  ] as const)("accepts and sends %s %s, which the form offers", async (field, value) => {
    expect(await updateSeriesItem({ seriesId: 10, [field]: value })).toEqual({ ok: true });
    expect(mocks.editSeries).toHaveBeenCalledWith({ seriesId: 10, [field]: value });
  });

  it("sends every field together, and exactly those fields", async () => {
    mocks.listSeriesQualityProfiles.mockResolvedValue(SERIES_PROFILES);

    await updateSeriesItem({
      seriesId: 10,
      qualityProfileId: 1,
      monitored: true,
      seriesType: "daily",
      seasonFolder: false,
      monitorNewItems: "none",
    });

    expect(mocks.editSeries).toHaveBeenCalledTimes(1);
    expect(mocks.editSeries.mock.calls[0][0]).toStrictEqual({
      seriesId: 10,
      qualityProfileId: 1,
      monitored: true,
      seriesType: "daily",
      seasonFolder: false,
      monitorNewItems: "none",
    });
  });

  it("refuses a quality profile that no longer exists, without editing, and refreshes so the form gets the current profiles", async () => {
    mocks.listSeriesQualityProfiles.mockResolvedValue(SERIES_PROFILES);

    const result = await updateSeriesItem({ seriesId: 10, qualityProfileId: 99 });

    expect(result).toEqual({ ok: false, error: "That quality profile no longer exists." });
    expect(mocks.editSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("gives the friendly error when Sonarr rejects the edit, and logs only the safe message", async () => {
    mocks.editSeries.mockRejectedValue(new ArrRequestError("Sonarr series edit request failed: HTTP 500", "http", 500));

    const result = await updateSeriesItem(seriesEdit);

    expect(result).toEqual({ ok: false, error: "Sonarr didn't accept the change. Try again." });
    expect(console.error).toHaveBeenCalledWith("Series edit: Sonarr series edit request failed: HTTP 500");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error when the profile list cannot be fetched, and does not edit", async () => {
    mocks.listSeriesQualityProfiles.mockRejectedValue(
      new ArrRequestError("Sonarr quality profile request failed: timed out", "timeout"),
    );

    const result = await updateSeriesItem({ seriesId: 10, qualityProfileId: 1 });

    expect(result).toEqual({ ok: false, error: "Sonarr didn't accept the change. Try again." });
    expect(mocks.editSeries).not.toHaveBeenCalled();
  });
});

describe("errors that are not Sonarr request failures are rethrown", () => {
  const rethrowRows: [string, Mock, () => Promise<unknown>][] = [
    ["setEpisodeMonitoring", mocks.setEpisodeMonitored, () => setEpisodeMonitoring({ episodeId: 42, monitored: true })],
    ["setSeasonMonitoring", mocks.setSeasonMonitored, () => setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })],
    ["searchSeasonNow", mocks.searchSeason, () => searchSeasonNow({ seriesId: 5, seasonNumber: 2 })],
    ["searchEpisodeNow", mocks.searchEpisode, () => searchEpisodeNow({ episodeId: 9 })],
    ["findSeriesReleases", mocks.searchSeriesReleases, () => findSeriesReleases({ seriesId: 10, seasonNumber: 2 })],
    ["grabSeriesRelease", mocks.grabSeriesRelease, () => grabSeriesRelease({ token: release.token })],
    ["updateSeriesItem", mocks.editSeries, () => updateSeriesItem(seriesEdit)],
  ];

  it.each(rethrowRows)("%s rethrows an error that is not a Sonarr request failure, and does not refresh", async (_name, mock, call) => {
    mock.mockRejectedValue(new Error("config broken"));

    await expect(call()).rejects.toThrow("config broken");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

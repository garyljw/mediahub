import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("setEpisodeMonitoring authorization", () => {
  it("checks for the admin role", async () => {
    await setEpisodeMonitoring({ episodeId: 1, monitored: true });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    const result = await setEpisodeMonitoring({ episodeId: 1, monitored: true });

    expect(result).toEqual({ ok: false, error: MONITOR_DENIED });
    expect(mocks.setEpisodeMonitored).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));
    expect(await setEpisodeMonitoring({ episodeId: 1, monitored: true })).toEqual({ ok: false, error: MONITOR_DENIED });
    expect(mocks.setEpisodeMonitored).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));
    await expect(setEpisodeMonitoring({ episodeId: 1, monitored: true })).rejects.toThrow("database down");
    expect(mocks.setEpisodeMonitored).not.toHaveBeenCalled();
  });
});

describe("setSeasonMonitoring authorization", () => {
  it("checks for the admin role", async () => {
    await setSeasonMonitoring({ seriesId: 1, seasonNumber: 2, monitored: true });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    const result = await setSeasonMonitoring({ seriesId: 1, seasonNumber: 2, monitored: true });

    expect(result).toEqual({ ok: false, error: MONITOR_DENIED });
    expect(mocks.setSeasonMonitored).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));
    expect(await setSeasonMonitoring({ seriesId: 1, seasonNumber: 2, monitored: true })).toEqual({ ok: false, error: MONITOR_DENIED });
    expect(mocks.setSeasonMonitored).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));
    await expect(setSeasonMonitoring({ seriesId: 1, seasonNumber: 2, monitored: true })).rejects.toThrow("database down");
    expect(mocks.setSeasonMonitored).not.toHaveBeenCalled();
  });
});

describe("searchSeasonNow and searchEpisodeNow authorization", () => {
  it("allows both admin and requester for a season search", async () => {
    await searchSeasonNow({ seriesId: 1, seasonNumber: 2 });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
  });

  it("allows both admin and requester for an episode search", async () => {
    await searchEpisodeNow({ episodeId: 3 });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "requester");
  });

  it("rejects a signed-out caller and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    expect(await searchSeasonNow({ seriesId: 1, seasonNumber: 2 })).toEqual({ ok: false, error: SEARCH_DENIED });
    expect(await searchEpisodeNow({ episodeId: 3 })).toEqual({ ok: false, error: SEARCH_DENIED });
    expect(mocks.searchSeason).not.toHaveBeenCalled();
    expect(mocks.searchEpisode).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));
    await expect(searchSeasonNow({ seriesId: 1, seasonNumber: 2 })).rejects.toThrow("database down");
    await expect(searchEpisodeNow({ episodeId: 3 })).rejects.toThrow("database down");
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

    expect(await setEpisodeMonitoring({ episodeId: 42, monitored: true })).toEqual({
      ok: false,
      error: "Sonarr didn't accept the change. Try again.",
    });
    expect(console.error).toHaveBeenCalledWith("Episode monitor: Sonarr episode monitor request failed: HTTP 400");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["a 5xx", new ArrRequestError("Sonarr episode monitor request failed: HTTP 502", "http", 502)],
    ["a dropped connection", new ArrRequestError("Sonarr episode monitor request failed: network error", "network")],
    ["an unreadable reply", new ArrRequestError("Sonarr episode monitor request failed: invalid response", "invalid")],
  ])("says the change may have been saved after %s", async (_name, error) => {
    mocks.setEpisodeMonitored.mockRejectedValue(error);

    expect(await setEpisodeMonitoring({ episodeId: 42, monitored: true })).toEqual({ ok: false, error: "Sonarr didn't confirm the change. It may still have been saved, so reload the page to check." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says a timed-out change may have been saved, and does not refresh", async () => {
    mocks.setEpisodeMonitored.mockRejectedValue(new ArrRequestError("Sonarr episode monitor request failed: timed out", "timeout"));

    const result = await setEpisodeMonitoring({ episodeId: 42, monitored: true });

    expect(result).toEqual({
      ok: false,
      error: "Sonarr took too long to answer. The change may still have been saved, so reload the page to check.",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.setEpisodeMonitored.mockRejectedValue(new Error("config broken"));
    await expect(setEpisodeMonitoring({ episodeId: 42, monitored: true })).rejects.toThrow("config broken");
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

    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({
      ok: false,
      error: "That season no longer exists.",
    });
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

    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({
      ok: false,
      error: "Sonarr didn't accept the change. Try again.",
    });
    expect(console.error).toHaveBeenCalledWith("Season monitor: Sonarr series update request failed: HTTP 400");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["a 5xx", new ArrRequestError("Sonarr series update request failed: HTTP 500", "http", 500)],
    ["an unreadable reply", new ArrRequestError("Sonarr series update request failed: invalid response", "invalid")],
  ])("says the change may have been saved after %s on the write", async (_name, error) => {
    failAfterSend(error);

    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({ ok: false, error: "Sonarr didn't confirm the change. It may still have been saved, so reload the page to check." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says a timeout on the write may have saved the change, and does not refresh", async () => {
    mocks.setSeasonMonitored.mockImplementation(async (_id: number, _season: number, _monitored: boolean, onSend: () => void) => {
      onSend();
      throw new ArrRequestError("Sonarr series update request failed: timed out", "timeout");
    });

    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({
      ok: false,
      error: "Sonarr took too long to answer. The change may still have been saved, so reload the page to check.",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("says the change may have been saved when the connection drops after the write was sent", async () => {
    mocks.setSeasonMonitored.mockImplementation(async (_id: number, _season: number, _monitored: boolean, onSend: () => void) => {
      onSend();
      throw new ArrRequestError("Sonarr series update request failed: network error", "network");
    });

    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({
      ok: false,
      error: "Sonarr didn't confirm the change. It may still have been saved, so reload the page to check.",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["timed out", new ArrRequestError("Sonarr series request failed: timed out", "timeout")],
    ["answered 500", new ArrRequestError("Sonarr series request failed: HTTP 500", "http", 500)],
  ])("says nothing changed when the read %s before anything was written", async (_name, error) => {
    mocks.setSeasonMonitored.mockRejectedValue(error);

    expect(await setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).toEqual({
      ok: false,
      error: "Couldn't load the series from Sonarr, so nothing changed. Try again.",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.setSeasonMonitored.mockRejectedValue(new Error("config broken"));
    await expect(setSeasonMonitoring({ seriesId: 5, seasonNumber: 3, monitored: true })).rejects.toThrow("config broken");
  });
});

describe("searchSeasonNow success and failure", () => {
  it("calls searchSeason with exactly the validated values, and does not refresh", async () => {
    expect(await searchSeasonNow({ seriesId: 5, seasonNumber: 0 })).toEqual({ ok: true });
    expect(mocks.searchSeason).toHaveBeenCalledWith(5, 0);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error when Sonarr rejects the search, and logs only the safe message", async () => {
    mocks.searchSeason.mockRejectedValue(new ArrRequestError("Sonarr season search command request failed: HTTP 500", "http", 500));

    expect(await searchSeasonNow({ seriesId: 5, seasonNumber: 2 })).toEqual({
      ok: false,
      error: "Sonarr didn't start the search. Try again.",
    });
    expect(console.error).toHaveBeenCalledWith("Season search: Sonarr season search command request failed: HTTP 500");
  });

  it("says a timed-out search may have started, so the user checks before retrying", async () => {
    mocks.searchSeason.mockRejectedValue(new ArrRequestError("Sonarr season search command request failed: timed out", "timeout"));

    expect(await searchSeasonNow({ seriesId: 5, seasonNumber: 2 })).toEqual({
      ok: false,
      error: "Sonarr took too long to answer. The search may still have started, so check Sonarr before trying again.",
    });
  });

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.searchSeason.mockRejectedValue(new Error("config broken"));
    await expect(searchSeasonNow({ seriesId: 5, seasonNumber: 2 })).rejects.toThrow("config broken");
  });
});

describe("searchEpisodeNow success and failure", () => {
  it("calls searchEpisode with exactly the validated id, and does not refresh", async () => {
    expect(await searchEpisodeNow({ episodeId: 9 })).toEqual({ ok: true });
    expect(mocks.searchEpisode).toHaveBeenCalledWith(9);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error when Sonarr rejects the search, and logs only the safe message", async () => {
    mocks.searchEpisode.mockRejectedValue(new ArrRequestError("Sonarr episode search command request failed: HTTP 500", "http", 500));

    expect(await searchEpisodeNow({ episodeId: 9 })).toEqual({
      ok: false,
      error: "Sonarr didn't start the search. Try again.",
    });
    expect(console.error).toHaveBeenCalledWith("Episode search: Sonarr episode search command request failed: HTTP 500");
  });

  it("says a timed-out search may have started, so the user checks before retrying", async () => {
    mocks.searchEpisode.mockRejectedValue(new ArrRequestError("Sonarr episode search command request failed: timed out", "timeout"));

    expect(await searchEpisodeNow({ episodeId: 9 })).toEqual({
      ok: false,
      error: "Sonarr took too long to answer. The search may still have started, so check Sonarr before trying again.",
    });
  });

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.searchEpisode.mockRejectedValue(new Error("config broken"));
    await expect(searchEpisodeNow({ episodeId: 9 })).rejects.toThrow("config broken");
  });
});

describe("findSeriesReleases and grabSeriesRelease", () => {
  const release = { token: "00000000-0000-4000-8000-000000000002" };

  describe("authorization", () => {
    it.each([
      ["findSeriesReleases", () => findSeriesReleases({ seriesId: 10, seasonNumber: 2 })],
      ["grabSeriesRelease", () => grabSeriesRelease({ token: release.token })],
    ])("checks for the admin role only in %s", async (_name, call) => {
      await call();
      expect(mocks.requireRole).toHaveBeenCalledWith("admin");
    });

    it.each([
      ["requester (403)", 403],
      ["signed-out (401)", 401],
    ] as const)("rejects a %s and never calls Sonarr", async (_label, status) => {
      mocks.requireRole.mockRejectedValue(new AuthzError(status));

      expect(await findSeriesReleases({ seriesId: 10, seasonNumber: 2 })).toEqual({ ok: false, error: PICK_DENIED });
      expect(await findSeriesReleases({ episodeId: 202 })).toEqual({ ok: false, error: PICK_DENIED });
      expect(await grabSeriesRelease({ token: release.token })).toEqual({ ok: false, error: PICK_DENIED });
      expect(mocks.searchSeriesReleases).not.toHaveBeenCalled();
      expect(mocks.grabSeriesRelease).not.toHaveBeenCalled();
    });

    it("rethrows errors that are not authorization failures", async () => {
      mocks.requireRole.mockRejectedValue(new Error("database down"));
      await expect(findSeriesReleases({ seriesId: 10, seasonNumber: 2 })).rejects.toThrow("database down");
      await expect(grabSeriesRelease({ token: release.token })).rejects.toThrow("database down");
      expect(mocks.searchSeriesReleases).not.toHaveBeenCalled();
      expect(mocks.grabSeriesRelease).not.toHaveBeenCalled();
    });
  });

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
      expect(await findSeriesReleases({ seriesId: 10, seasonNumber: 2 })).toEqual({
        ok: false,
        error: "Sonarr took too long searching the indexers. Try again in a moment.",
      });
      expect(console.error).toHaveBeenCalledWith("Release search: Sonarr release search request failed: timed out");
    });

    it("says the season or episode is gone on a 404", async () => {
      mocks.searchSeriesReleases.mockRejectedValue(new ArrRequestError("Sonarr release search request failed: HTTP 404", "http", 404));
      expect(await findSeriesReleases({ episodeId: 202 })).toEqual({
        ok: false,
        error: "That season or episode is no longer in Sonarr. Close this and reload the page.",
      });
    });

    it("gives the generic message for other Sonarr failures", async () => {
      mocks.searchSeriesReleases.mockRejectedValue(new ArrRequestError("Sonarr release search request failed: HTTP 400", "http", 400));
      expect(await findSeriesReleases({ seriesId: 10, seasonNumber: 2 })).toEqual({
        ok: false,
        error: "Sonarr couldn't search the indexers. Try again.",
      });
    });

    it("rethrows errors that are not Sonarr request failures", async () => {
      mocks.searchSeriesReleases.mockRejectedValue(new Error("config broken"));
      await expect(findSeriesReleases({ seriesId: 10, seasonNumber: 2 })).rejects.toThrow("config broken");
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
      expect(await grabSeriesRelease({ token: release.token })).toEqual({
        ok: false,
        error: "Sonarr can no longer use that result: it may have expired, or Sonarr couldn't match it to episodes. Search again or pick another one.",
      });
    });

    it("warns about a possible grab after a timeout", async () => {
      mocks.grabSeriesRelease.mockRejectedValue(new ArrRequestError("Sonarr release grab request failed: timed out", "timeout"));
      expect(await grabSeriesRelease({ token: release.token })).toEqual({
        ok: false,
        error: "Sonarr took too long to answer. The release may still have been grabbed, so check the queue before trying again.",
      });
      expect(console.error).toHaveBeenCalledWith("Release grab: Sonarr release grab request failed: timed out");
    });

    it("says the indexer did not hand over the release on a 409", async () => {
      mocks.grabSeriesRelease.mockRejectedValue(new ArrRequestError("Sonarr release grab request failed: HTTP 409", "http", 409));
      expect(await grabSeriesRelease({ token: release.token })).toEqual({
        ok: false,
        error: "The indexer didn't hand over that release. Try again, or pick another one.",
      });
    });

    it("gives the plain refusal message for other 4xx errors", async () => {
      mocks.grabSeriesRelease.mockRejectedValue(new ArrRequestError("Sonarr release grab request failed: HTTP 400", "http", 400));
      expect(await grabSeriesRelease({ token: release.token })).toEqual({
        ok: false,
        error: "Sonarr didn't grab the release. Try again.",
      });
    });

    it("warns about a possible grab after a 5xx, since Sonarr may have sent the release first", async () => {
      mocks.grabSeriesRelease.mockRejectedValue(new ArrRequestError("Sonarr release grab request failed: HTTP 500", "http", 500));
      expect(await grabSeriesRelease({ token: release.token })).toEqual({
        ok: false,
        error: "Sonarr didn't confirm the grab. It may still have been sent, so check the queue before trying again.",
      });
    });

    it("warns about a possible grab after a network error", async () => {
      mocks.grabSeriesRelease.mockRejectedValue(new ArrRequestError("Sonarr release grab request failed: network error", "network"));
      expect(await grabSeriesRelease({ token: release.token })).toEqual({
        ok: false,
        error: "Sonarr didn't confirm the grab. It may still have been sent, so check the queue before trying again.",
      });
    });

    it("rethrows errors that are not Sonarr request failures", async () => {
      mocks.grabSeriesRelease.mockRejectedValue(new Error("config broken"));
      await expect(grabSeriesRelease({ token: release.token })).rejects.toThrow("config broken");
    });
  });
});

describe("deleteSeriesItem", () => {
  const DELETE_DENIED = "You don't have permission to delete series.";
  const DELETE_INVALID = "Invalid delete.";
  const validDelete = { seriesId: 4, deleteFiles: false, addImportListExclusion: false };

  it("checks for the admin role only", async () => {
    await expect(deleteSeriesItem(validDelete)).rejects.toThrow("NEXT_REDIRECT /");
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Sonarr or redirects", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await deleteSeriesItem(validDelete)).toEqual({ ok: false, error: DELETE_DENIED });
    expect(mocks.deleteSeries).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));
    await expect(deleteSeriesItem(validDelete)).rejects.toThrow("database down");
    expect(mocks.deleteSeries).not.toHaveBeenCalled();
  });

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

const SERIES_EDIT_DENIED = "You don't have permission to edit series.";
const SERIES_EDIT_INVALID = "Invalid edit.";
const seriesEdit = { seriesId: 10, monitored: true };
const SERIES_PROFILES = [
  { id: 1, name: "HD-1080p" },
  { id: 2, name: "Any" },
];

describe("updateSeriesItem authorization", () => {
  it("checks for the admin role only", async () => {
    await updateSeriesItem(seriesEdit);

    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("rejects a requester and never calls Sonarr or refreshes", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await updateSeriesItem(seriesEdit)).toEqual({ ok: false, error: SERIES_EDIT_DENIED });
    expect(mocks.editSeries).not.toHaveBeenCalled();
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    expect(await updateSeriesItem(seriesEdit)).toEqual({ ok: false, error: SERIES_EDIT_DENIED });
    expect(mocks.editSeries).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(updateSeriesItem(seriesEdit)).rejects.toThrow("database down");
    expect(mocks.editSeries).not.toHaveBeenCalled();
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
  it("sends the id and a monitored flag, without checking profiles", async () => {
    expect(await updateSeriesItem({ seriesId: 10, monitored: false })).toEqual({ ok: true });

    expect(mocks.editSeries).toHaveBeenCalledWith({ seriesId: 10, monitored: false });
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
  });

  it("checks that a chosen quality profile still exists, then sends it", async () => {
    mocks.listSeriesQualityProfiles.mockResolvedValue(SERIES_PROFILES);

    expect(await updateSeriesItem({ seriesId: 10, qualityProfileId: 2 })).toEqual({ ok: true });

    expect(mocks.listSeriesQualityProfiles).toHaveBeenCalledTimes(1);
    expect(mocks.editSeries).toHaveBeenCalledWith({ seriesId: 10, qualityProfileId: 2 });
  });

  it.each(["standard", "daily", "anime"] as const)("sends series type %s alone", async (seriesType) => {
    expect(await updateSeriesItem({ seriesId: 10, seriesType })).toEqual({ ok: true });

    expect(mocks.editSeries).toHaveBeenCalledWith({ seriesId: 10, seriesType });
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
  });

  it("sends a false season folder flag, which is a real change", async () => {
    expect(await updateSeriesItem({ seriesId: 10, seasonFolder: false })).toEqual({ ok: true });

    expect(mocks.editSeries).toHaveBeenCalledWith({ seriesId: 10, seasonFolder: false });
  });

  it.each(["all", "none"] as const)("sends new-season monitoring %s alone", async (monitorNewItems) => {
    expect(await updateSeriesItem({ seriesId: 10, monitorNewItems })).toEqual({ ok: true });

    expect(mocks.editSeries).toHaveBeenCalledWith({ seriesId: 10, monitorNewItems });
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

  it("refreshes the page after a successful edit", async () => {
    await updateSeriesItem(seriesEdit);

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
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

  it("gives the same friendly error after a timeout", async () => {
    mocks.editSeries.mockRejectedValue(new ArrRequestError("Sonarr series edit request failed: timed out", "timeout"));

    expect(await updateSeriesItem(seriesEdit)).toEqual({ ok: false, error: "Sonarr didn't accept the change. Try again." });
    expect(console.error).toHaveBeenCalledWith("Series edit: Sonarr series edit request failed: timed out");
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

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.editSeries.mockRejectedValue(new Error("config broken"));

    await expect(updateSeriesItem(seriesEdit)).rejects.toThrow("config broken");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

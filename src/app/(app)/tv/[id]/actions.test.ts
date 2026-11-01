import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  setEpisodeMonitored: vi.fn(),
  setSeasonMonitored: vi.fn(),
  searchSeason: vi.fn(),
  searchEpisode: vi.fn(),
  refresh: vi.fn(),
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
import { searchEpisodeNow, searchSeasonNow, setEpisodeMonitoring, setSeasonMonitoring } from "./actions";

const MONITOR_DENIED = "You don't have permission to change monitoring.";
const SEARCH_DENIED = "You don't have permission to search for episodes.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.setEpisodeMonitored.mockResolvedValue(undefined);
  mocks.setSeasonMonitored.mockResolvedValue(undefined);
  mocks.searchSeason.mockResolvedValue(undefined);
  mocks.searchEpisode.mockResolvedValue(undefined);
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

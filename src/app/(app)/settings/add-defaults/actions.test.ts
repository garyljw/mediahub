import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listQualityProfiles: vi.fn(),
  listRootFolders: vi.fn(),
  listSeriesQualityProfiles: vi.fn(),
  listSeriesRootFolders: vi.fn(),
  saveMovieAddDefaults: vi.fn(),
  saveSeriesAddDefaults: vi.fn(),
  revalidatePath: vi.fn(),
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

vi.mock("@/server/arr/movies", () => ({ listQualityProfiles: mocks.listQualityProfiles }));
vi.mock("@/server/arr/movie-add", () => ({ listRootFolders: mocks.listRootFolders }));
vi.mock("@/server/arr/series", () => ({ listSeriesQualityProfiles: mocks.listSeriesQualityProfiles }));
vi.mock("@/server/arr/series-add", () => ({ listSeriesRootFolders: mocks.listSeriesRootFolders }));
vi.mock("@/server/settings/add-defaults", () => ({
  saveMovieAddDefaults: mocks.saveMovieAddDefaults,
  saveSeriesAddDefaults: mocks.saveSeriesAddDefaults,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { AuthzError } from "@/server/authz";
import { ArrRequestError } from "@/server/arr/request";
import { saveMovieDefaults, saveSeriesDefaults } from "./actions";

const DENIED = "You don't have permission to change add defaults.";
const MOVIE_INVALID = "Choose a quality profile and root folder.";
const SERIES_INVALID = "Choose a quality profile, root folder and monitor option.";

const RADARR_PROFILES = [{ id: 4, name: "Any" }, { id: 2, name: "HD-1080p" }];
const RADARR_FOLDERS = [{ id: 7, path: "/invented/movies/", freeSpace: null }];
const SONARR_PROFILES = [{ id: 3, name: "Standard" }];
const SONARR_FOLDERS = [{ id: 8, path: "/invented/tv/", freeSpace: null }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.listQualityProfiles.mockResolvedValue(RADARR_PROFILES);
  mocks.listRootFolders.mockResolvedValue(RADARR_FOLDERS);
  mocks.listSeriesQualityProfiles.mockResolvedValue(SONARR_PROFILES);
  mocks.listSeriesRootFolders.mockResolvedValue(SONARR_FOLDERS);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const movieInput = { profileId: 2, rootFolderId: 7 };
const seriesInput = { profileId: 3, rootFolderId: 8, monitor: "future" };

describe.each([
  ["saveMovieDefaults", saveMovieDefaults, movieInput],
  ["saveSeriesDefaults", saveSeriesDefaults, seriesInput],
])("%s authorization", (_name, action, input) => {
  it("checks for the admin role", async () => {
    await action(input);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never reads Arr or saves", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await action(input)).toEqual({ ok: false, message: DENIED });
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.listRootFolders).not.toHaveBeenCalled();
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.listSeriesRootFolders).not.toHaveBeenCalled();
    expect(mocks.saveMovieAddDefaults).not.toHaveBeenCalled();
    expect(mocks.saveSeriesAddDefaults).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and saves nothing", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    expect(await action(input)).toEqual({ ok: false, message: DENIED });
    expect(mocks.saveMovieAddDefaults).not.toHaveBeenCalled();
    expect(mocks.saveSeriesAddDefaults).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(action(input)).rejects.toThrow("database down");
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
  });
});

describe("saveMovieDefaults", () => {
  it("saves exactly the parsed ids and refreshes the layout", async () => {
    expect(await saveMovieDefaults(movieInput)).toEqual({ ok: true });
    expect(mocks.saveMovieAddDefaults).toHaveBeenCalledWith({ profileId: 2, rootFolderId: 7 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(mocks.saveSeriesAddDefaults).not.toHaveBeenCalled();
  });

  it.each([
    ["an extra key", { ...movieInput, monitor: "all" }],
    ["a missing profile", { rootFolderId: 7 }],
    ["a missing folder", { profileId: 2 }],
    ["a non-integer id", { profileId: 2.5, rootFolderId: 7 }],
    ["a zero id", { profileId: 0, rootFolderId: 7 }],
    ["a negative id", { profileId: 2, rootFolderId: -7 }],
    ["an id sent as a string", { profileId: "2", rootFolderId: 7 }],
    ["not an object", "2,7"],
  ])("refuses %s without reading Radarr or saving", async (_label, input) => {
    expect(await saveMovieDefaults(input)).toEqual({ ok: false, message: MOVIE_INVALID });
    expect(mocks.listQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.saveMovieAddDefaults).not.toHaveBeenCalled();
  });

  it("refuses a profile that is not in Radarr's list", async () => {
    expect(await saveMovieDefaults({ profileId: 99, rootFolderId: 7 })).toEqual({
      ok: false,
      message: "That quality profile or root folder no longer exists in Radarr.",
    });
    expect(mocks.saveMovieAddDefaults).not.toHaveBeenCalled();
  });

  it("refuses a root folder that is not in Radarr's list", async () => {
    expect(await saveMovieDefaults({ profileId: 2, rootFolderId: 99 })).toEqual({
      ok: false,
      message: "That quality profile or root folder no longer exists in Radarr.",
    });
    expect(mocks.saveMovieAddDefaults).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports an Arr failure without saving, and logs only the message", async () => {
    mocks.listRootFolders.mockRejectedValue(new ArrRequestError("Radarr root folder timed out", "timeout"));

    expect(await saveMovieDefaults(movieInput)).toEqual({ ok: false, message: "Couldn't reach Radarr." });
    expect(mocks.saveMovieAddDefaults).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("Add defaults (Radarr): Radarr root folder timed out");
  });

  it("rethrows errors that are not Arr request failures", async () => {
    mocks.listQualityProfiles.mockRejectedValue(new Error("bug"));

    await expect(saveMovieDefaults(movieInput)).rejects.toThrow("bug");
    expect(mocks.saveMovieAddDefaults).not.toHaveBeenCalled();
  });
});

describe("saveSeriesDefaults", () => {
  it("saves exactly the parsed ids and monitor and refreshes the layout", async () => {
    expect(await saveSeriesDefaults(seriesInput)).toEqual({ ok: true });
    expect(mocks.saveSeriesAddDefaults).toHaveBeenCalledWith({ profileId: 3, rootFolderId: 8, monitor: "future" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(mocks.saveMovieAddDefaults).not.toHaveBeenCalled();
  });

  it.each([
    ["an extra key", { ...seriesInput, seriesType: "anime" }],
    ["a monitor that is not an option", { ...seriesInput, monitor: "everything" }],
    ["a missing monitor", { profileId: 3, rootFolderId: 8 }],
    ["a non-integer id", { ...seriesInput, rootFolderId: 8.5 }],
    ["a zero id", { ...seriesInput, profileId: 0 }],
  ])("refuses %s without reading Sonarr or saving", async (_label, input) => {
    expect(await saveSeriesDefaults(input)).toEqual({ ok: false, message: SERIES_INVALID });
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.saveSeriesAddDefaults).not.toHaveBeenCalled();
  });

  it("refuses a profile that is not in Sonarr's list", async () => {
    expect(await saveSeriesDefaults({ ...seriesInput, profileId: 99 })).toEqual({
      ok: false,
      message: "That quality profile or root folder no longer exists in Sonarr.",
    });
    expect(mocks.saveSeriesAddDefaults).not.toHaveBeenCalled();
  });

  it("refuses a root folder that is not in Sonarr's list", async () => {
    expect(await saveSeriesDefaults({ ...seriesInput, rootFolderId: 99 })).toEqual({
      ok: false,
      message: "That quality profile or root folder no longer exists in Sonarr.",
    });
    expect(mocks.saveSeriesAddDefaults).not.toHaveBeenCalled();
  });

  it("reports an Arr failure without saving, and logs only the message", async () => {
    mocks.listSeriesQualityProfiles.mockRejectedValue(new ArrRequestError("Sonarr quality profile returned HTTP 500", "http", 500));

    expect(await saveSeriesDefaults(seriesInput)).toEqual({ ok: false, message: "Couldn't reach Sonarr." });
    expect(mocks.saveSeriesAddDefaults).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("Add defaults (Sonarr): Sonarr quality profile returned HTTP 500");
  });

  it("rethrows errors that are not Arr request failures", async () => {
    mocks.listSeriesRootFolders.mockRejectedValue(new Error("bug"));

    await expect(saveSeriesDefaults(seriesInput)).rejects.toThrow("bug");
    expect(mocks.saveSeriesAddDefaults).not.toHaveBeenCalled();
  });
});

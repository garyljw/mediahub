import { describe, expect, it } from "vitest";
import { MONITOR_LABELS, SERIES_MONITOR_OPTIONS, SERIES_TYPE_LABELS, SERIES_TYPE_OPTIONS, buildSeriesAddRequest, defaultSeriesOptions, isSeriesInLibrary } from "./series-add";

const profiles = [
  { id: 4, name: "Any" },
  { id: 2, name: "HD-1080p" },
];
const folders = [
  { id: 7, path: "/invented/tv/", freeSpace: 1288490188 },
  { id: 8, path: "/invented/other/", freeSpace: null },
];

describe("defaultSeriesOptions", () => {
  it("selects the first profile and root folder, monitor all, standard, and search on", () => {
    expect(defaultSeriesOptions(profiles, folders)).toEqual({
      profileId: 4,
      rootFolderId: 7,
      monitor: "all",
      seriesType: "standard",
      searchForMissingEpisodes: true,
    });
  });

  it("selects nothing for profile and folder when the lists are empty or the folder list failed", () => {
    expect(defaultSeriesOptions([], [])).toMatchObject({ profileId: null, rootFolderId: null });
    expect(defaultSeriesOptions(profiles, null)).toMatchObject({ profileId: 4, rootFolderId: null });
  });

  it("uses the saved profile, root folder and monitor when they are in the lists", () => {
    expect(defaultSeriesOptions(profiles, folders, { profileId: 2, rootFolderId: 8, monitor: "missing" })).toMatchObject({
      profileId: 2,
      rootFolderId: 8,
      monitor: "missing",
      seriesType: "standard",
      searchForMissingEpisodes: true,
    });
  });

  it("falls back to the first profile and folder when the saved ids are missing from the lists", () => {
    expect(defaultSeriesOptions(profiles, folders, { profileId: 99, rootFolderId: 99, monitor: null })).toMatchObject({
      profileId: 4,
      rootFolderId: 7,
    });
  });

  it("defaults the monitor to all when none is saved", () => {
    expect(defaultSeriesOptions(profiles, folders, { profileId: null, rootFolderId: null, monitor: null }).monitor).toBe("all");
    expect(defaultSeriesOptions(profiles, folders).monitor).toBe("all");
  });

  it("selects no folder when the folder list is null, even with a saved folder", () => {
    expect(defaultSeriesOptions(profiles, null, { profileId: 2, rootFolderId: 8, monitor: "none" })).toMatchObject({
      profileId: 2,
      rootFolderId: null,
      monitor: "none",
    });
  });
});

describe("buildSeriesAddRequest", () => {
  it("builds the payload from the chosen options and result id", () => {
    expect(
      buildSeriesAddRequest(200001, {
        profileId: 2,
        rootFolderId: 8,
        monitor: "future",
        seriesType: "anime",
        searchForMissingEpisodes: false,
      }),
    ).toStrictEqual({
      tvdbId: 200001,
      qualityProfileId: 2,
      rootFolderId: 8,
      monitor: "future",
      seriesType: "anime",
      searchForMissingEpisodes: false,
    });
  });

  it("returns null when no profile or root folder is selected", () => {
    const options = { profileId: null, rootFolderId: 7, monitor: "all" as const, seriesType: "standard" as const, searchForMissingEpisodes: true };
    expect(buildSeriesAddRequest(1, options)).toBeNull();
    expect(buildSeriesAddRequest(1, { ...options, profileId: 2, rootFolderId: null })).toBeNull();
  });
});

describe("isSeriesInLibrary", () => {
  it("is true when Sonarr said so or the dialog added it", () => {
    expect(isSeriesInLibrary({ tvdbId: 1, inLibrary: true }, new Set())).toBe(true);
    expect(isSeriesInLibrary({ tvdbId: 2, inLibrary: false }, new Set([2]))).toBe(true);
    expect(isSeriesInLibrary({ tvdbId: 3, inLibrary: false }, new Set([2]))).toBe(false);
  });
});

describe("option labels", () => {
  it("has a label for every monitor and series type option, and no extra keys", () => {
    expect(SERIES_MONITOR_OPTIONS.map((option) => MONITOR_LABELS[option])).toEqual([
      "All episodes",
      "Future episodes",
      "Missing episodes",
      "Existing episodes",
      "First season",
      "Latest season",
      "None",
    ]);
    expect(Object.keys(MONITOR_LABELS).sort()).toEqual([...SERIES_MONITOR_OPTIONS].sort());
    expect(SERIES_TYPE_OPTIONS.map((option) => SERIES_TYPE_LABELS[option])).toEqual(["Standard", "Daily", "Anime"]);
  });
});

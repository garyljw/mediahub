import { describe, expect, it } from "vitest";
import { buildAddRequest, defaultOptions, isInLibrary } from "./movie-add";

const profiles = [
  { id: 4, name: "Any" },
  { id: 2, name: "HD-1080p" },
];
const folders = [
  { id: 7, path: "/invented/movies/", freeSpace: 1288490188 },
  { id: 8, path: "/invented/other/", freeSpace: null },
];

describe("defaultOptions", () => {
  it("selects the first profile and root folder, with both checkboxes on", () => {
    expect(defaultOptions(profiles, folders)).toEqual({ profileId: 4, rootFolderId: 7, monitored: true, searchForMovie: true });
  });

  it("selects nothing when there are no profiles or root folders", () => {
    expect(defaultOptions([], [])).toEqual({ profileId: null, rootFolderId: null, monitored: true, searchForMovie: true });
  });

  it("selects no root folder when the folder list could not be loaded (null)", () => {
    expect(defaultOptions(profiles, null)).toEqual({ profileId: 4, rootFolderId: null, monitored: true, searchForMovie: true });
  });
});

describe("buildAddRequest", () => {
  it("builds the payload from the chosen options and result id", () => {
    expect(buildAddRequest(910001, { profileId: 2, rootFolderId: 8, monitored: false, searchForMovie: true })).toStrictEqual({
      tmdbId: 910001,
      qualityProfileId: 2,
      rootFolderId: 8,
      monitored: false,
      searchForMovie: true,
    });
  });

  it("returns null when no profile or root folder is selected", () => {
    const options = { profileId: null, rootFolderId: 7, monitored: true, searchForMovie: true };
    expect(buildAddRequest(1, options)).toBeNull();
    expect(buildAddRequest(1, { ...options, profileId: 2, rootFolderId: null })).toBeNull();
  });
});

describe("isInLibrary", () => {
  it("is true when Radarr said so or the dialog added it", () => {
    expect(isInLibrary({ tmdbId: 1, inLibrary: true }, new Set())).toBe(true);
    expect(isInLibrary({ tmdbId: 2, inLibrary: false }, new Set([2]))).toBe(true);
    expect(isInLibrary({ tmdbId: 3, inLibrary: false }, new Set([2]))).toBe(false);
  });
});

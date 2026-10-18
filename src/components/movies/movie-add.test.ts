import { describe, expect, it } from "vitest";
import {
  addedMessage,
  buildAddRequest,
  defaultOptions,
  folderLabel,
  isInLibrary,
  normalizeTerm,
  resultLabel,
} from "./movie-add";

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

describe("normalizeTerm", () => {
  it("trims the term", () => {
    expect(normalizeTerm("  Lantern Harbour  ")).toBe("Lantern Harbour");
  });

  it("returns null for an empty or whitespace-only term", () => {
    expect(normalizeTerm("")).toBeNull();
    expect(normalizeTerm("   ")).toBeNull();
  });

  it("caps the term at 100 characters", () => {
    expect(normalizeTerm("x".repeat(150))).toHaveLength(100);
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

describe("labels and messages", () => {
  it("shows the year in brackets when known", () => {
    expect(resultLabel({ title: "Lantern Harbour", year: 2021 })).toBe("Lantern Harbour (2021)");
    expect(resultLabel({ title: "Lantern Harbour", year: null })).toBe("Lantern Harbour");
  });

  it("builds the status line after an add", () => {
    expect(addedMessage({ title: "Lantern Harbour", year: 2021 })).toBe("Added Lantern Harbour (2021).");
    expect(addedMessage({ title: "Lantern Harbour", year: null })).toBe("Added Lantern Harbour.");
  });
});

describe("isInLibrary", () => {
  it("is true when Radarr said so or the dialog added it", () => {
    expect(isInLibrary({ tmdbId: 1, inLibrary: true }, new Set())).toBe(true);
    expect(isInLibrary({ tmdbId: 2, inLibrary: false }, new Set([2]))).toBe(true);
    expect(isInLibrary({ tmdbId: 3, inLibrary: false }, new Set([2]))).toBe(false);
  });
});

describe("folderLabel", () => {
  it("adds the free space when Radarr reported some", () => {
    expect(folderLabel(folders[0])).toBe("/invented/movies/ (1.2 GB free)");
  });

  it("shows only the path when free space is unknown or zero", () => {
    expect(folderLabel(folders[1])).toBe("/invented/other/");
    expect(folderLabel({ id: 9, path: "/invented/full/", freeSpace: 0 })).toBe("/invented/full/");
  });
});

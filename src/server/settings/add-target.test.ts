import "server-only";
import { describe, expect, it } from "vitest";
import { resolveAddTarget } from "./add-target";

const profiles = [{ id: 4 }, { id: 2 }];
const folders = [
  { id: 7, path: "/invented/movies/" },
  { id: 8, path: "/invented/other/" },
];

function resolve(overrides: Partial<Parameters<typeof resolveAddTarget>[0]> = {}) {
  return resolveAddTarget({
    app: "Radarr",
    noun: "movies",
    profiles,
    folders,
    saved: { profileId: null, rootFolderId: null },
    ...overrides,
  });
}

describe("resolveAddTarget", () => {
  it("uses the saved profile and root folder when they are still in the lists", () => {
    expect(resolve({ saved: { profileId: 2, rootFolderId: 8 } })).toEqual({
      ok: true,
      qualityProfileId: 2,
      rootFolderPath: "/invented/other/",
    });
  });

  it("falls back to the first profile and folder when the saved ids are stale", () => {
    expect(resolve({ saved: { profileId: 99, rootFolderId: 99 } })).toEqual({
      ok: true,
      qualityProfileId: 4,
      rootFolderPath: "/invented/movies/",
    });
  });

  it("falls back to the first of each when nothing is saved", () => {
    expect(resolve()).toEqual({ ok: true, qualityProfileId: 4, rootFolderPath: "/invented/movies/" });
  });

  it("honours a requested profile over the saved default", () => {
    expect(resolve({ saved: { profileId: 2, rootFolderId: 7 }, requestedProfileId: 4 })).toEqual({
      ok: true,
      qualityProfileId: 4,
      rootFolderPath: "/invented/movies/",
    });
  });

  it("refuses a requested profile that is not in the list", () => {
    expect(resolve({ requestedProfileId: 99 })).toEqual({ ok: false, error: "That quality profile no longer exists." });
  });

  it("honours a requested root folder over the saved default", () => {
    expect(resolve({ saved: { profileId: null, rootFolderId: 7 }, requestedRootFolderId: 8 })).toEqual({
      ok: true,
      qualityProfileId: 4,
      rootFolderPath: "/invented/other/",
    });
  });

  it("refuses a requested root folder that is not in the list", () => {
    expect(resolve({ requestedRootFolderId: 99 })).toEqual({ ok: false, error: "That root folder no longer exists." });
  });

  it("says there are no quality profiles, using the app and noun", () => {
    expect(resolve({ profiles: [] })).toEqual({
      ok: false,
      error: "Radarr has no quality profiles set up, so movies can't be added yet.",
    });
    expect(
      resolveAddTarget({ app: "Sonarr", noun: "series", profiles: [], folders, saved: { profileId: null, rootFolderId: null } }),
    ).toEqual({ ok: false, error: "Sonarr has no quality profiles set up, so series can't be added yet." });
  });

  it("says there are no root folders, using the app and noun", () => {
    expect(resolve({ folders: [] })).toEqual({
      ok: false,
      error: "Radarr has no root folders set up, so movies can't be added yet.",
    });
    expect(
      resolveAddTarget({ app: "Sonarr", noun: "series", profiles, folders: [], saved: { profileId: null, rootFolderId: null } }),
    ).toEqual({ ok: false, error: "Sonarr has no root folders set up, so series can't be added yet." });
  });
});

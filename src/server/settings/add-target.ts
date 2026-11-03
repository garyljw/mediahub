import "server-only";

/** Where an add goes: the quality profile id and the root folder path, or the reason it can't be done. */
export type AddTarget = { ok: true; qualityProfileId: number; rootFolderPath: string } | { ok: false; error: string };

/**
 * Pure: picks the profile and root folder for one add. An admin's requested profile or folder is used when given,
 * and must exist. Otherwise the saved default is used when it is still in the list, and the first item when it is
 * not. No DB or Arr calls.
 */
export function resolveAddTarget(args: {
  app: "Radarr" | "Sonarr";
  /** "movies" or "series", used in the messages. */
  noun: string;
  profiles: readonly { id: number }[];
  folders: readonly { id: number; path: string }[];
  saved: { profileId: number | null; rootFolderId: number | null };
  /** Admin only. The add action never passes this for a requester. */
  requestedProfileId?: number;
  /** Admin only. The add action never passes this for a requester. */
  requestedRootFolderId?: number;
}): AddTarget {
  const { app, noun, profiles, folders, saved, requestedProfileId, requestedRootFolderId } = args;

  let profile: { id: number } | undefined;
  if (requestedProfileId !== undefined) {
    profile = profiles.find((option) => option.id === requestedProfileId);
    if (!profile) return { ok: false, error: "That quality profile no longer exists." };
  } else {
    profile = profiles.find((option) => option.id === saved.profileId) ?? profiles[0];
  }
  if (!profile) return { ok: false, error: `${app} has no quality profiles set up, so ${noun} can't be added yet.` };

  let folder: { id: number; path: string } | undefined;
  if (requestedRootFolderId !== undefined) {
    folder = folders.find((option) => option.id === requestedRootFolderId);
    if (!folder) return { ok: false, error: "That root folder no longer exists." };
  } else {
    folder = folders.find((option) => option.id === saved.rootFolderId) ?? folders[0];
  }
  if (!folder) return { ok: false, error: `${app} has no root folders set up, so ${noun} can't be added yet.` };

  return { ok: true, qualityProfileId: profile.id, rootFolderPath: folder.path };
}

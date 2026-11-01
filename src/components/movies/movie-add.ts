// Pure logic for the Add movie dialog. Must not import from src/server at runtime (type imports are fine).
import type { LookupResult } from "@/server/arr/movie-add";
import type { RootFolderOption } from "@/server/arr/root-folders";
import type { QualityProfileOption } from "@/server/arr/profiles";

/** The dialog's options. They apply to whichever result the admin or requester clicks Add on. */
export type AddOptions = {
  profileId: number | null;
  rootFolderId: number | null;
  monitored: boolean;
  searchForMovie: boolean;
};

/**
 * First profile and first root folder selected, both checkboxes on. Lists come from the server sorted.
 * A null folder list (Radarr's root folders could not be loaded) selects nothing.
 */
export function defaultOptions(
  profiles: readonly QualityProfileOption[],
  folders: readonly RootFolderOption[] | null,
): AddOptions {
  return {
    profileId: profiles[0]?.id ?? null,
    rootFolderId: folders?.[0]?.id ?? null,
    monitored: true,
    searchForMovie: true,
  };
}

/**
 * The addLibraryMovie payload for one result, or null when no profile or root folder is selected
 * (the dialog disables Add in that case, so this is a guard).
 */
export function buildAddRequest(tmdbId: number, options: AddOptions) {
  if (options.profileId === null || options.rootFolderId === null) return null;
  return {
    tmdbId,
    qualityProfileId: options.profileId,
    rootFolderId: options.rootFolderId,
    monitored: options.monitored,
    searchForMovie: options.searchForMovie,
  };
}

/** Whether a result shows "In library": Radarr said so on the search, or it was added during this dialog. */
export function isInLibrary(result: Pick<LookupResult, "tmdbId" | "inLibrary">, addedIds: ReadonlySet<number>): boolean {
  return result.inLibrary || addedIds.has(result.tmdbId);
}

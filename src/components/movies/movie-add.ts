// Pure logic for the Add movie dialog. Must not import from src/server at runtime (type imports are fine).
import type { LookupResult, RootFolderOption } from "@/server/arr/movie-add";
import type { QualityProfileOption } from "@/server/arr/profiles";
import { formatSize } from "@/components/library/format";

/** The dialog's options. They apply to whichever result the admin or requester clicks Add on. */
export type AddOptions = {
  profileId: number | null;
  rootFolderId: number | null;
  monitored: boolean;
  searchForMovie: boolean;
};

/** Longest search term, in characters. The server's Zod limit in src/app/(app)/movies/actions.ts imports this same value. */
export const MAX_TERM_LENGTH = 100;

/** Shown in place of a failed call the dialog can't explain better (e.g. a thrown error). */
export const GENERIC_ERROR = "Something went wrong. Reload the page and try again.";

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

/** The trimmed search term, or null when nothing is left to search for. */
export function normalizeTerm(term: string): string | null {
  const trimmed = term.trim();
  return trimmed === "" ? null : trimmed.slice(0, MAX_TERM_LENGTH);
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

/** "Title (Year)", or just the title when the year is unknown. */
export function resultLabel(result: { title: string; year: number | null }): string {
  return result.year === null ? result.title : `${result.title} (${result.year})`;
}

/** The status line after a successful add. */
export function addedMessage(result: { title: string; year: number | null }): string {
  return `Added ${resultLabel(result)}.`;
}

/** Whether a result shows "In library": Radarr said so on the search, or it was added during this dialog. */
export function isInLibrary(result: Pick<LookupResult, "tmdbId" | "inLibrary">, addedIds: ReadonlySet<number>): boolean {
  return result.inLibrary || addedIds.has(result.tmdbId);
}

/** Root folder label for the dropdown: its path, plus free space when Radarr reported some. */
export function folderLabel(folder: RootFolderOption): string {
  return folder.freeSpace !== null && folder.freeSpace > 0 ? `${folder.path} (${formatSize(folder.freeSpace)} free)` : folder.path;
}

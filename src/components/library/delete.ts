// Pure delete-dialog logic for the movie and series pages. Must not import from src/server at runtime.
import type { Noun } from "./nouns";

/** How many titles the delete dialog lists before "and N more". */
export const DELETE_LIST_LIMIT = 10;

/** The word the admin types to confirm deleting files. Matched trimmed and case-insensitively. */
export const CONFIRM_WORD = "delete";

/** The parts of a movie or series row the delete dialog shows. */
export type DeleteItem = { title: string; year: number | null };

/** Dialog title: "Delete <title>?" for one item, otherwise "Delete N movies?" / "Delete N series?". */
export function deleteTitle(items: readonly DeleteItem[], noun: Noun): string {
  const only = items[0];
  if (items.length === 1 && only) return `Delete ${only.title}?`;
  return `Delete ${items.length} ${noun.many}?`;
}

/** "Title (Year)", or just the title when the year is unknown. */
export function itemLabel(item: DeleteItem): string {
  return item.year === null ? item.title : `${item.title} (${item.year})`;
}

/**
 * The lines the dialog lists: the first DELETE_LIST_LIMIT items, and an "and N more" line when
 * there are more. `more` is null when nothing was left out.
 */
export function listedItems(items: readonly DeleteItem[]): { shown: string[]; more: string | null } {
  const hidden = Math.max(0, items.length - DELETE_LIST_LIMIT);
  return {
    shown: items.slice(0, DELETE_LIST_LIMIT).map(itemLabel),
    more: hidden > 0 ? `and ${hidden} more` : null,
  };
}

/** Confirm button text: "Delete movie" / "Delete N movies" (or series), with " and files" when files are deleted too. */
export function confirmLabel(count: number, deleteFiles: boolean, noun: Noun): string {
  const subject = count === 1 ? noun.one : `${count} ${noun.many}`;
  return `Delete ${subject}${deleteFiles ? " and files" : ""}`;
}

/** True when the typed text is the confirm word, ignoring case and surrounding spaces. */
export function typedConfirmMatches(typed: string): boolean {
  return typed.trim().toLowerCase() === CONFIRM_WORD;
}

/** Confirm is allowed unless files are being deleted and the admin has not typed the confirm word. */
export function canConfirmDelete(deleteFiles: boolean, typed: string): boolean {
  return !deleteFiles || typedConfirmMatches(typed);
}

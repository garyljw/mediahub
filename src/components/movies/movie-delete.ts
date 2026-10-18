// Pure delete-dialog logic for the Movies table. Must not import from src/server at runtime.

/** How many titles the delete dialog lists before "and N more". */
export const DELETE_LIST_LIMIT = 10;

/** The word the admin types to confirm deleting files. Matched trimmed and case-insensitively. */
export const CONFIRM_WORD = "delete";

/** The parts of a movie row the delete dialog shows. */
export type DeleteMovie = { title: string; year: number | null };

/** Dialog title: "Delete <title>?" for one movie, otherwise "Delete N movies?". */
export function deleteTitle(movies: readonly DeleteMovie[]): string {
  const only = movies[0];
  if (movies.length === 1 && only) return `Delete ${only.title}?`;
  return `Delete ${movies.length} movies?`;
}

/** "Title (Year)", or just the title when the year is unknown. */
export function movieLabel(movie: DeleteMovie): string {
  return movie.year === null ? movie.title : `${movie.title} (${movie.year})`;
}

/**
 * The lines the dialog lists: the first DELETE_LIST_LIMIT movies, and an "and N more" line when
 * there are more. `more` is null when nothing was left out.
 */
export function listedMovies(movies: readonly DeleteMovie[]): { shown: string[]; more: string | null } {
  const hidden = Math.max(0, movies.length - DELETE_LIST_LIMIT);
  return {
    shown: movies.slice(0, DELETE_LIST_LIMIT).map(movieLabel),
    more: hidden > 0 ? `and ${hidden} more` : null,
  };
}

/** Confirm button text: "Delete movie" / "Delete N movies", with " and files" when files are deleted too. */
export function confirmLabel(count: number, deleteFiles: boolean): string {
  const noun = count === 1 ? "movie" : `${count} movies`;
  return `Delete ${noun}${deleteFiles ? " and files" : ""}`;
}

/** True when the typed text is the confirm word, ignoring case and surrounding spaces. */
export function typedConfirmMatches(typed: string): boolean {
  return typed.trim().toLowerCase() === CONFIRM_WORD;
}

/** Confirm is allowed unless files are being deleted and the admin has not typed the confirm word. */
export function canConfirmDelete(deleteFiles: boolean, typed: string): boolean {
  return !deleteFiles || typedConfirmMatches(typed);
}

/** The status line after a successful delete. */
export function deletedMessage(movieCount: number): string {
  return `Deleted ${movieCount} ${movieCount === 1 ? "movie" : "movies"}`;
}

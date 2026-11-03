// Shared pure helpers for the Add page. Must not import from src/server at runtime (type imports are fine).

/** Longest search term, in characters. The server's Zod limits in the Movies and TV actions import this same value. */
export const MAX_TERM_LENGTH = 100;

/** Shown in place of a failed call the dialog can't explain better (e.g. a thrown error). */
export const GENERIC_ERROR = "Something went wrong. Reload the page and try again.";

/** The trimmed search term, or null when nothing is left to search for. */
export function normalizeTerm(term: string): string | null {
  const trimmed = term.trim();
  return trimmed === "" ? null : trimmed.slice(0, MAX_TERM_LENGTH);
}

/** "Title (Year)", or just the title when the year is unknown. */
export function resultLabel(result: { title: string; year: number | null }): string {
  return result.year === null ? result.title : `${result.title} (${result.year})`;
}

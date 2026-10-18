// Pure selection and edit-payload logic for the Movies table. Must not import from src/server at runtime.
import type { MovieEdit } from "@/server/arr/movies";

/** Largest bulk edit the server accepts (src/app/(app)/movies/actions.ts uses this same value). */
export const MAX_EDIT_MOVIES = 2000;

/** What the dialog's Monitored select says. "keep" leaves each movie's flag alone. */
export type MonitorChoice = "keep" | "monitored" | "unmonitored";

/**
 * The bulk edit to send, or null when nothing would change (or there is nothing to change).
 * Fields left at "Keep current" are omitted, so the server never sees a no-op field.
 */
export function buildEditPayload(
  movieIds: readonly number[],
  profileId: number | null,
  monitor: MonitorChoice,
): MovieEdit | null {
  if (movieIds.length === 0) return null;
  const edit: MovieEdit = { movieIds: [...movieIds] };
  if (profileId !== null) edit.qualityProfileId = profileId;
  if (monitor !== "keep") edit.monitored = monitor === "monitored";
  return edit.qualityProfileId === undefined && edit.monitored === undefined ? null : edit;
}

/** Toggles one id. Returns a new Set, so React sees the change. */
export function toggleId(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Header checkbox: when every filtered movie is selected, clears the filtered movies. Otherwise selects all of
 * them. Ids outside the filtered list (e.g. filtered out earlier) are left alone.
 */
export function toggleAllFiltered(selected: ReadonlySet<number>, filtered: readonly { id: number }[]): Set<number> {
  const allSelected = filtered.length > 0 && filtered.every((row) => selected.has(row.id));
  const next = new Set(selected);
  for (const row of filtered) {
    if (allSelected) next.delete(row.id);
    else next.add(row.id);
  }
  return next;
}

export type SelectAllState = "none" | "some" | "all";

/** Whether the header checkbox is empty, mixed (some filtered movies selected) or full. */
export function selectAllState(selected: ReadonlySet<number>, filtered: readonly { id: number }[]): SelectAllState {
  let count = 0;
  for (const row of filtered) if (selected.has(row.id)) count += 1;
  if (count === 0) return "none";
  return count === filtered.length ? "all" : "some";
}

/** Keeps only the selected ids that are still in rows. A refresh that removes a movie drops it from the selection. */
export function pruneSelection(selected: ReadonlySet<number>, rows: readonly { id: number }[]): Set<number> {
  const live = new Set(rows.map((row) => row.id));
  return new Set([...selected].filter((id) => live.has(id)));
}

/** Dialog title: the movie's own title for a single edit, otherwise "Edit N movies". */
export function editTitle(movieCount: number, movieTitle?: string): string {
  if (movieTitle !== undefined) return movieTitle;
  return `Edit ${movieCount} ${movieCount === 1 ? "movie" : "movies"}`;
}

/** The brief status line after a successful edit. */
export function updatedMessage(movieCount: number): string {
  return `Updated ${movieCount} ${movieCount === 1 ? "movie" : "movies"}`;
}

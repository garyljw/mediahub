// Pure row-selection logic for the library tables. Must not import from src/server at runtime.

/** Toggles one id. Returns a new Set, so React sees the change. */
export function toggleId(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Header checkbox: when every filtered row is selected, clears the filtered rows. Otherwise selects all of
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

/** Whether the header checkbox is empty, mixed (some filtered rows selected) or full. */
export function selectAllState(selected: ReadonlySet<number>, filtered: readonly { id: number }[]): SelectAllState {
  let count = 0;
  for (const row of filtered) if (selected.has(row.id)) count += 1;
  if (count === 0) return "none";
  return count === filtered.length ? "all" : "some";
}

/** Keeps only the selected ids that are still in rows. A refresh that removes a row drops it from the selection. */
export function pruneSelection(selected: ReadonlySet<number>, rows: readonly { id: number }[]): Set<number> {
  const live = new Set(rows.map((row) => row.id));
  return new Set([...selected].filter((id) => live.has(id)));
}

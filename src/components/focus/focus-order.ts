// Pure helpers for the Focus page's order. Client-safe: no imports from src/server. The server checks the final
// order again (see src/server/merge/focus.ts).

/** The ids with `id` moved to `toIndex` (0-based, in the list after `id` is taken out). Same as arrayMove. */
export function moveInOrder(ids: readonly number[], id: number, toIndex: number): number[] {
  const from = ids.indexOf(id);
  if (from === -1) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, id);
  return next;
}

/**
 * The full Focus list after the visible items were reordered. Hidden items (ones no longer in the library) keep their
 * slots, so the server still gets every id it stores. visibleIds and nextVisibleIds hold the same ids.
 */
export function mergeVisibleOrder(allIds: readonly number[], visibleIds: readonly number[], nextVisibleIds: readonly number[]): number[] {
  const visible = new Set(visibleIds);
  let next = 0;
  return allIds.map((id) => {
    if (!visible.has(id)) return id;
    const replacement = nextVisibleIds[next];
    next += 1;
    return replacement ?? id;
  });
}

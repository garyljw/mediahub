import "server-only";

/**
 * Pure: checks that orderedIds is a rearrangement of currentIds (same ids, each once) and returns it as the new order.
 * Returns null for anything else: a stale list, a missing or extra id, or a duplicate. Ids are compared as numbers.
 */
export function applyFocusOrder(currentIds: readonly number[], orderedIds: readonly number[]): number[] | null {
  if (orderedIds.length !== currentIds.length) return null;
  const current = new Set(currentIds);
  const seen = new Set<number>();
  for (const id of orderedIds) {
    if (!current.has(id) || seen.has(id)) return null;
    seen.add(id);
  }
  return [...orderedIds];
}

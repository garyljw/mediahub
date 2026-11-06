import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { focusItem } from "@/server/db/schema";
import { applyFocusOrder } from "@/server/merge/focus";
import { FOCUS_KINDS, type FocusKind } from "@/components/focus/focus-kinds";

// Household-wide Focus lists, kept in SQLite. Items are keyed by Arr id, so a Radarr id and a Sonarr id may match.
// Positions are always 0..n-1 within a kind: add appends, remove closes the gap, reorder rewrites them. Every write
// runs in one transaction.

export { FOCUS_KINDS, type FocusKind };

/** An abuse guard per list, not a product cap. Nothing in the UI shows it except as the error when it is hit. */
export const MAX_FOCUS_ITEMS = 500;

export type FocusMembership = { movie: Set<number>; series: Set<number> };

/** The list changed since the page was loaded, or the new order is not a rearrangement of it. Nothing is written. */
export class FocusOrderError extends Error {
  constructor() {
    super("focus order does not match the current list");
    this.name = "FocusOrderError";
  }
}

/** Adding would go past MAX_FOCUS_ITEMS for the kind. Nothing is written. */
export class FocusLimitError extends Error {
  constructor() {
    super("focus list is full");
    this.name = "FocusLimitError";
  }
}

/** The Arr ids in a list, in list order. */
export function listFocusIds(kind: FocusKind): number[] {
  return db()
    .select({ arrId: focusItem.arrId })
    .from(focusItem)
    .where(eq(focusItem.kind, kind))
    .orderBy(asc(focusItem.position))
    .all()
    .map((row) => row.arrId);
}

/** Which movies and series are in a Focus list, for the Home menu and markers. */
export function focusMembership(): FocusMembership {
  const membership: FocusMembership = { movie: new Set(), series: new Set() };
  for (const row of db().select().from(focusItem).all()) membership[row.kind].add(row.arrId);
  return membership;
}

/** Appends an item to the end of its list. Adding one already there is a no-op. */
export function addToFocus(kind: FocusKind, arrId: number, userId: string): void {
  db().transaction((tx) => {
    const existing = tx
      .select({ arrId: focusItem.arrId })
      .from(focusItem)
      .where(and(eq(focusItem.kind, kind), eq(focusItem.arrId, arrId)))
      .get();
    if (existing) return;

    const count = tx
      .select({ total: sql<number>`count(*)` })
      .from(focusItem)
      .where(eq(focusItem.kind, kind))
      .get()?.total ?? 0;
    if (count >= MAX_FOCUS_ITEMS) throw new FocusLimitError();

    // Positions are 0..n-1, so the new item goes at position n.
    tx.insert(focusItem).values({ kind, arrId, position: count, addedBy: userId, addedAt: new Date() }).run();
  });
}

/**
 * Removes items and closes the gaps, in one transaction. Ids not in the list are ignored, so removing one that isn't
 * there is a no-op. Returns how many rows were removed.
 */
export function removeFromFocus(kind: FocusKind, arrIds: readonly number[]): number {
  if (arrIds.length === 0) return 0;
  return db().transaction((tx) => {
    const removed = tx
      .delete(focusItem)
      .where(and(eq(focusItem.kind, kind), inArray(focusItem.arrId, [...arrIds])))
      .run();
    if (removed.changes === 0) return 0;

    const remaining = tx
      .select({ arrId: focusItem.arrId })
      .from(focusItem)
      .where(eq(focusItem.kind, kind))
      .orderBy(asc(focusItem.position))
      .all();
    remaining.forEach((row, position) => {
      tx.update(focusItem)
        .set({ position })
        .where(and(eq(focusItem.kind, kind), eq(focusItem.arrId, row.arrId)))
        .run();
    });
    return removed.changes;
  });
}

/**
 * Sets the new full order of a list. orderedIds must be exactly the ids the list holds now, each once. Otherwise
 * this throws FocusOrderError and writes nothing.
 */
export function reorderFocus(kind: FocusKind, orderedIds: readonly number[]): void {
  db().transaction((tx) => {
    const current = tx
      .select({ arrId: focusItem.arrId })
      .from(focusItem)
      .where(eq(focusItem.kind, kind))
      .orderBy(asc(focusItem.position))
      .all()
      .map((row) => row.arrId);

    const next = applyFocusOrder(current, orderedIds);
    if (next === null) throw new FocusOrderError();

    next.forEach((arrId, position) => {
      tx.update(focusItem)
        .set({ position })
        .where(and(eq(focusItem.kind, kind), eq(focusItem.arrId, arrId)))
        .run();
    });
  });
}


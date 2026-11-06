import "server-only";
import type { PlexItemKey } from "@/server/merge/watched";

// Pure: works out which Plex section a Focus list belongs in, which Plex items it wants and in what order, and the
// moves that turn one order into another. No I/O here (the sync is in server/focus/plex-sync.ts).

export type FocusPlan = {
  /** The Plex section the collection is in: the stored one while it holds any title, else the one holding most. */
  sectionKey: string;
  /** The ratingKeys to put in the collection, in list order. Titles not in Plex yet are left out. */
  wanted: string[];
};

/**
 * Pure: picks the section, then lists one item per title from that section in list order. The stored section is kept
 * while it holds at least one of the list's titles, so the collection never moves back and forth between sections.
 * Otherwise the section holding the most titles wins (a title in several sections counts for each), and a tie goes to
 * the lowest section key. Returns null when no title is in Plex at all.
 */
export function planFocusCollection({
  ids,
  externalIds,
  itemKeys,
  storedSectionKey,
}: {
  /** The list's Arr ids, in list order. */
  ids: readonly number[];
  /** Arr id -> TMDB id (movies) or TVDB id (series). Ids with no external id are not here. */
  externalIds: ReadonlyMap<number, number>;
  /** External id -> the Plex items listing it, from the watched index. */
  itemKeys: ReadonlyMap<number, readonly PlexItemKey[]>;
  /** The section the existing collection is in, or null when none is stored. */
  storedSectionKey: string | null;
}): FocusPlan | null {
  // The Plex items of each title that is in Plex, in list order.
  const titles: (readonly PlexItemKey[])[] = [];
  for (const id of ids) {
    const external = externalIds.get(id);
    if (external === undefined) continue;
    const keys = itemKeys.get(external);
    if (keys && keys.length > 0) titles.push(keys);
  }

  const counts = new Map<string, number>();
  for (const keys of titles) {
    for (const sectionKey of new Set(keys.map((key) => key.sectionKey))) {
      counts.set(sectionKey, (counts.get(sectionKey) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;

  const most = Math.max(...counts.values());
  const tied = [...counts].filter(([, count]) => count === most).map(([sectionKey]) => sectionKey);
  const sectionKey =
    storedSectionKey !== null && counts.has(storedSectionKey)
      ? storedSectionKey
      : tied.reduce((lowest, candidate) => (Number(candidate) < Number(lowest) ? candidate : lowest));

  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const keys of titles) {
    const key = keys.find((candidate) => candidate.sectionKey === sectionKey);
    if (!key || seen.has(key.ratingKey)) continue;
    seen.add(key.ratingKey);
    wanted.push(key.ratingKey);
  }
  return { sectionKey, wanted };
}

/**
 * Pure: the moves that turn `actual` into `wanted`, applied in order. Both hold the same keys. Walks `wanted`; where
 * the list differs at index i, moves wanted[i] to sit after wanted[i - 1] (to the front when i is 0). Same order gives
 * no moves.
 */
export function collectionMoves(actual: readonly string[], wanted: readonly string[]): { itemKey: string; after: string | null }[] {
  const simulated = [...actual];
  const moves: { itemKey: string; after: string | null }[] = [];
  for (let i = 0; i < wanted.length; i++) {
    const itemKey = wanted[i];
    if (itemKey === undefined || simulated[i] === itemKey) continue;
    const from = simulated.indexOf(itemKey);
    simulated.splice(from, 1);
    simulated.splice(i, 0, itemKey);
    moves.push({ itemKey, after: i === 0 ? null : (wanted[i - 1] ?? null) });
  }
  return moves;
}

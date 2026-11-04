import "server-only";
import type { PlexSectionItem } from "@/server/plex/server";
import type { WatchedState } from "@/components/home/home-items";

export type { WatchedState } from "@/components/home/home-items";

// Pure: turns Plex library items into a watched state per TMDB id (movies) and TVDB id (series). No I/O here.

/** The watched state of one id, by TMDB id (movies) and TVDB id (series). */
export type WatchedIndex = { movies: Map<number, WatchedState>; series: Map<number, WatchedState> };

const TMDB_GUID = /^tmdb:\/\/(\d+)$/;
const TVDB_GUID = /^tvdb:\/\/(\d+)$/;

const RANK: Record<WatchedState, number> = { unwatched: 0, partial: 1, watched: 2 };

/** A movie is watched once viewed, partly watched once started, and unwatched otherwise. */
export function movieWatchedState(item: PlexSectionItem): WatchedState {
  if (item.viewCount > 0) return "watched";
  if (item.viewOffset > 0) return "partial";
  return "unwatched";
}

/** A show is watched when every episode is viewed. A show with no episodes has no state (null). */
export function showWatchedState(item: PlexSectionItem): WatchedState | null {
  if (item.leafCount <= 0) return null;
  if (item.viewedLeafCount >= item.leafCount) return "watched";
  if (item.viewedLeafCount > 0) return "partial";
  return "unwatched";
}

/** Every guid matching the pattern, as positive integer ids (an item can list more than one). */
function idsFromGuids(guids: string[], pattern: RegExp): number[] {
  const ids: number[] = [];
  for (const guid of guids) {
    const match = pattern.exec(guid);
    if (!match) continue;
    const id = Number(match[1]);
    if (Number.isSafeInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

/** Records a state for an id. When the id is already there (in another library), the more watched state is kept. */
function keepMostWatched(map: Map<number, WatchedState>, id: number, state: WatchedState): void {
  const existing = map.get(id);
  if (existing === undefined || RANK[state] > RANK[existing]) map.set(id, state);
}

/**
 * Pure: builds the index from every movie section's items and every show section's items. An item with no matching
 * guid is skipped; an item with several is indexed under each. The same id in several items keeps the most watched state.
 */
export function toWatchedIndex(movieItems: PlexSectionItem[], showItems: PlexSectionItem[]): WatchedIndex {
  const index: WatchedIndex = { movies: new Map(), series: new Map() };

  for (const item of movieItems) {
    const state = movieWatchedState(item);
    for (const tmdbId of idsFromGuids(item.guids, TMDB_GUID)) keepMostWatched(index.movies, tmdbId, state);
  }

  for (const item of showItems) {
    const state = showWatchedState(item);
    if (state === null) continue;
    for (const tvdbId of idsFromGuids(item.guids, TVDB_GUID)) keepMostWatched(index.series, tvdbId, state);
  }

  return index;
}

import "server-only";
import type { PlexEpisodeItem, PlexSectionItem } from "@/server/plex/server";
import type { WatchedState } from "@/components/home/home-items";

export type { WatchedState } from "@/components/home/home-items";

// Pure: turns Plex library items into a watched state per TMDB id (movies) and TVDB id (series), and Plex episodes
// into a state per Sonarr episode. No I/O here.

/** The watched state of one id, by TMDB id (movies) and TVDB id (series). */
export type WatchedIndex = {
  movies: Map<number, WatchedState>;
  series: Map<number, WatchedState>;
  /** TVDB series id -> the ratingKey of every Plex show listing it, so its episodes can be loaded. */
  showKeys: Map<number, string[]>;
};

/** The Sonarr fields the episode match needs. */
export type EpisodeRef = { id: number; tvdbId: number | null; seasonNumber: number; episodeNumber: number };

const TMDB_GUID = /^tmdb:\/\/(\d+)$/;
const TVDB_GUID = /^tvdb:\/\/(\d+)$/;

const RANK: Record<WatchedState, number> = { unwatched: 0, partial: 1, watched: 2 };

/** Watched once viewed, partly watched once started, and unwatched otherwise. Shared by movies and episodes. */
function viewedState(viewCount: number, viewOffset: number): WatchedState {
  if (viewCount > 0) return "watched";
  if (viewOffset > 0) return "partial";
  return "unwatched";
}

/** A movie is watched once viewed, partly watched once started, and unwatched otherwise. */
export function movieWatchedState(item: PlexSectionItem): WatchedState {
  return viewedState(item.viewCount, item.viewOffset);
}

/** An episode uses the same rule as a movie. */
export function episodeWatchedState(item: PlexEpisodeItem): WatchedState {
  return viewedState(item.viewCount, item.viewOffset);
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

/** Records a state for a key. When the key is already there (in another library), the more watched state is kept. */
function keepMostWatched<K>(map: Map<K, WatchedState>, key: K, state: WatchedState): void {
  const existing = map.get(key);
  if (existing === undefined || RANK[state] > RANK[existing]) map.set(key, state);
}

/**
 * Pure: builds the index from every movie section's items and every show section's items. An item with no matching
 * guid is skipped; an item with several is indexed under each. The same id in several items keeps the most watched state.
 * A show with no episodes has no state, so its ratingKey is not recorded either.
 */
export function toWatchedIndex(movieItems: PlexSectionItem[], showItems: PlexSectionItem[]): WatchedIndex {
  const index: WatchedIndex = { movies: new Map(), series: new Map(), showKeys: new Map() };

  for (const item of movieItems) {
    const state = movieWatchedState(item);
    for (const tmdbId of idsFromGuids(item.guids, TMDB_GUID)) keepMostWatched(index.movies, tmdbId, state);
  }

  for (const item of showItems) {
    const state = showWatchedState(item);
    if (state === null) continue;
    for (const tvdbId of idsFromGuids(item.guids, TVDB_GUID)) {
      keepMostWatched(index.series, tvdbId, state);
      if (item.ratingKey === null) continue;
      const keys = index.showKeys.get(tvdbId) ?? [];
      if (!keys.includes(item.ratingKey)) keys.push(item.ratingKey);
      index.showKeys.set(tvdbId, keys);
    }
  }

  return index;
}

/**
 * Pure: the watched state of each Sonarr episode, keyed by its Sonarr id. Plex episodes with a TVDB guid are matched
 * by that id. Plex episodes without one are matched by season and episode number, because their numbering may follow
 * a different order. A Plex episode with a TVDB guid is never matched by number. An episode with no match gets no entry.
 */
export function toEpisodeWatched(episodes: EpisodeRef[], plexEpisodes: PlexEpisodeItem[]): Map<number, WatchedState> {
  const byTvdb = new Map<number, WatchedState>();
  const byNumber = new Map<string, WatchedState>();

  for (const plex of plexEpisodes) {
    const state = episodeWatchedState(plex);
    const tvdbIds = idsFromGuids(plex.guids, TVDB_GUID);
    for (const tvdbId of tvdbIds) keepMostWatched(byTvdb, tvdbId, state);
    if (tvdbIds.length === 0 && plex.season !== null && plex.episode !== null) {
      keepMostWatched(byNumber, `${plex.season}:${plex.episode}`, state);
    }
  }

  const result = new Map<number, WatchedState>();
  for (const episode of episodes) {
    const byId = episode.tvdbId === null ? undefined : byTvdb.get(episode.tvdbId);
    const state = byId ?? byNumber.get(`${episode.seasonNumber}:${episode.episodeNumber}`);
    if (state !== undefined) result.set(episode.id, state);
  }
  return result;
}

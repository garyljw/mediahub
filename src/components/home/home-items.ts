// Pure helpers for the Home grid: the merged item shape, filtering and ordering. Client-safe: no runtime imports from src/server.
import { matchesTitleOrYear, TITLE_COLLATOR } from "@/components/library/list";

/** A Plex watched state: unwatched, partly watched, or watched. The only Plex detail the browser ever receives. */
export type WatchedState = "unwatched" | "partial" | "watched";

/** The banner text for each watched state. Static strings, so server and browser render the same text. */
export const WATCHED_LABEL: Record<WatchedState, string> = {
  unwatched: "Unwatched",
  partial: "Partly watched",
  watched: "Watched",
};

/**
 * The banner and badge colour for each watched state. Unwatched gets the brand gradient (the state worth noticing),
 * partly watched the gradient's purple end, and watched a solid dark slate that reads on any poster but stays quiet.
 */
export const WATCHED_CLASS: Record<WatchedState, string> = {
  unwatched: "bg-brand text-white",
  partial: "bg-brand-to text-white",
  watched: "bg-watched text-white",
};

/** One tile on the Home grid. `key` is needed because movie and series ids can collide. */
export type HomeItem = {
  key: string;
  kind: "movie" | "series";
  id: number;
  title: string;
  year: number | null;
  sortTitle: string;
  /** Not used by the A–Z order. Kept for the planned "Date added" sort. */
  added: string | null;
  href: string;
  posterSrc: string | null;
  badge: { label: string; className: string };
  /** True when there is something to watch: a movie with its file, or a series with at least one episode file. The tile shows the poster in greyscale otherwise. */
  onDisk: boolean;
  /** The Plex watched state, or null when the item isn't in Plex (or Plex isn't connected). */
  watched: WatchedState | null;
  /** True when the title is in its Focus list (Movie Focus for movies, TV Focus for series). */
  inFocus: boolean;
};

export type HomeKind = "all" | "movie" | "series";

/** The watch-status filter: "any" keeps every item, otherwise one Plex watched state. */
export type HomeWatchFilter = "any" | WatchedState;

/** Chip labels for the watch-status filter, in display order. */
export const WATCH_FILTER_CHIPS: { value: HomeWatchFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "unwatched", label: "Unwatched" },
  { value: "partial", label: "Partly watched" },
  { value: "watched", label: "Watched" },
];

export type HomeFilter = {
  kind: HomeKind;
  search: string;
  /**
   * Missing or "any" keeps every item. Otherwise only items with that Plex state; items Plex doesn't know (watched null)
   * never match a specific state.
   */
  watched?: HomeWatchFilter;
};

/**
 * Keeps the items of one kind (or all kinds) that match the search and the watch-status filter. An empty search matches
 * everything, and a missing or "any" watch filter keeps every watched state.
 */
export function filterHomeItems(items: HomeItem[], filter: HomeFilter): HomeItem[] {
  return items.filter(
    (item) =>
      (filter.kind === "all" || item.kind === filter.kind) &&
      matchesTitleOrYear(item, filter.search) &&
      (filter.watched === undefined || filter.watched === "any" || item.watched === filter.watched),
  );
}

/** True when at least one title has a Plex watched state, i.e. Plex is connected and answered. */
export function hasWatchData(items: HomeItem[]): boolean {
  return items.some((item) => item.watched !== null);
}

/**
 * The library as the Home page streams it: the merged items, and whether each app's library failed to load. Built on
 * the server before the page is sent, and read by the grid with `use`. Never rejects.
 */
export type HomeLibrary = { items: HomeItem[]; moviesFailed: boolean; seriesFailed: boolean };

/**
 * The Plex watched status for the grid, as it streams in: "ready" with a state per item key (only the items Plex
 * matched), "none" when no Plex data connection is set up, or "failed" when Plex couldn't be read. Never rejects.
 */
export type HomeWatched = { state: "ready"; byKey: Record<string, WatchedState> } | { state: "none" } | { state: "failed" };

/**
 * Sets each item's `watched` from a key map. A key that's missing, or a null map, gives null. An item whose state
 * doesn't change keeps its object, so memoised tiles skip re-rendering.
 */
export function withWatched(items: HomeItem[], byKey: Record<string, WatchedState> | null): HomeItem[] {
  let changed = false;
  const next = items.map((item) => {
    const watched = byKey?.[item.key] ?? null;
    if (watched === item.watched) return item;
    changed = true;
    return { ...item, watched };
  });
  return changed ? next : items;
}

// Movies sort before series when everything else ties.
const KIND_RANK: Record<HomeItem["kind"], number> = { movie: 0, series: 1 };

/**
 * A–Z by sort title. Radarr and Sonarr both lowercase sortTitle and drop a leading "The" or "A" (checked on a live
 * instance: "The Expanse" is "expanse"), so movies and series interleave correctly. Ties go movie before series,
 * then by id. Use with Array.prototype.sort.
 */
export function compareHomeItems(a: HomeItem, b: HomeItem): number {
  return (
    TITLE_COLLATOR.compare(a.sortTitle, b.sortTitle) ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    a.id - b.id
  );
}

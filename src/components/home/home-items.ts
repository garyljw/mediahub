// Pure helpers for the Home grid: the merged item shape, filtering and ordering. Client-safe: no runtime imports from src/server.
import { matchesTitleOrYear, TITLE_COLLATOR } from "@/components/library/list";
import { readChoice, writeChoice } from "@/components/library/release";

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
  /** When it first came out: a movie's earliest release (cinema, digital or physical) or a series' first aired date. Null when unknown. */
  released: string | null;
  /** A movie's latest release date (cinema, digital or physical) or a series' most recently aired episode. Null when unknown. */
  latest: string | null;
  /** Bytes on disk. 0 when nothing is downloaded. */
  sizeOnDisk: number;
  /**
   * When the title was downloaded, with the page's download-date stream. Null until it arrives, and for a title with no
   * file. `recorded` is true when the date is the import in Radarr's or Sonarr's history; false when it is the file
   * record's date, used for a title with a file but no import record.
   */
  downloaded: HomeDownloadDate | null;
  href: string;
  posterSrc: string | null;
  badge: { label: string; className: string };
  /** True when there is something to watch: a movie with its file, or a series with at least one episode file. The tile shows the poster in greyscale otherwise. */
  onDisk: boolean;
  /** The Plex watched state, or null when the item isn't in Plex (or Plex isn't connected). */
  watched: WatchedState | null;
  /** The title's genre names, as Radarr or Sonarr list them. Empty when none. */
  genres: string[];
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
  /** Null or missing keeps every item. Otherwise only items whose genres include this exact name. */
  genre?: string | null;
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
      (filter.watched === undefined || filter.watched === "any" || item.watched === filter.watched) &&
      (filter.genre == null || item.genres.includes(filter.genre)),
  );
}

/** One entry in the genre filter: a genre name and how many titles of the chosen kind have it. */
export type GenreOption = { genre: string; count: number };

/**
 * The distinct genres among the items of one kind (or all kinds), A–Z, each with its title count. `keep` is the genre
 * the filter has chosen: it stays listed with count 0 when no item of this kind has it, so the choice stays visible
 * and can be cleared.
 */
export function genreOptions(items: HomeItem[], kind: HomeKind, keep: string | null = null): GenreOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (kind !== "all" && item.kind !== kind) continue;
    for (const genre of item.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  if (keep !== null && !counts.has(keep)) counts.set(keep, 0);
  return [...counts]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => TITLE_COLLATOR.compare(a.genre, b.genre));
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

/**
 * A title's download date. `recorded` is true when it is the import in Radarr's or Sonarr's history, and false when it is
 * the file record's date (a title with a file but no import record).
 */
export type HomeDownloadDate = { at: string; recorded: boolean };

/**
 * The download dates for the grid, as they stream in: "ready" with a date per item key (movie:id and series:id; only
 * titles with a file), `incomplete` when some dates couldn't be loaded, or "failed" when they couldn't be built at all.
 * Never rejects.
 */
export type HomeDownloaded =
  | { state: "ready"; byKey: Record<string, HomeDownloadDate>; incomplete: boolean }
  | { state: "failed" };

function sameDownloadDate(a: HomeDownloadDate | null, b: HomeDownloadDate | null): boolean {
  if (a === null || b === null) return a === b;
  return a.at === b.at && a.recorded === b.recorded;
}

/**
 * Sets each item's `downloaded` from a key map, for movies and series alike. An item missing from the map gets null. An
 * item whose date doesn't change keeps its object, so memoised tiles skip re-rendering.
 */
export function withDownloaded(items: HomeItem[], byKey: Record<string, HomeDownloadDate> | null): HomeItem[] {
  let changed = false;
  const next = items.map((item) => {
    const downloaded = byKey?.[item.key] ?? null;
    if (sameDownloadDate(downloaded, item.downloaded)) return item;
    changed = true;
    return { ...item, downloaded };
  });
  return changed ? next : items;
}

/** The sorts the Home grid offers. Each key says which direction it starts in when first chosen. */
export type HomeSortKey = "title" | "downloaded" | "released" | "latest" | "size";
export type HomeSortDir = "asc" | "desc";

export const HOME_SORTS: { key: HomeSortKey; label: string; defaultDir: HomeSortDir }[] = [
  { key: "title", label: "Title", defaultDir: "asc" },
  { key: "downloaded", label: "Date downloaded", defaultDir: "desc" },
  { key: "released", label: "First released", defaultDir: "desc" },
  { key: "latest", label: "Latest release", defaultDir: "desc" },
  { key: "size", label: "Size on disk", defaultDir: "desc" },
];

/** The value a sort compares for one item, or null when the item has nothing to compare. */
function sortValue(item: HomeItem, key: HomeSortKey): number | null {
  if (key === "size") return item.sizeOnDisk > 0 ? item.sizeOnDisk : null;
  return timeOf(key === "latest" ? item.latest : item.released);
}

/** The download-date group: recorded imports first, then file dates, then titles with no date. */
const RECORDED = 0;
const FILE_DATE = 1;
const NO_DATE = 2;

function downloadGroup(item: HomeItem): { group: number; time: number | null } {
  const time = timeOf(item.downloaded?.at ?? null);
  if (time === null) return { group: NO_DATE, time: null };
  return { group: item.downloaded?.recorded ? RECORDED : FILE_DATE, time };
}

/** Epoch milliseconds for an ISO date, or null when it's missing or doesn't parse. */
function timeOf(value: string | null): number | null {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * Returns a new array in the chosen order. Title sorts A–Z (or Z–A) with compareHomeItems. First released, latest release and size sort
 * newest or largest first when descending, and smallest or oldest first when ascending, with an item that has no value
 * (no date, an unparsable date, or size 0) last in both directions. Date downloaded is grouped first (see downloadGroup).
 * Ties, and the no-value group, fall back to A–Z.
 */
export function sortHomeItems(items: HomeItem[], key: HomeSortKey, dir: HomeSortDir): HomeItem[] {
  const sign = dir === "asc" ? 1 : -1;
  if (key === "title") return [...items].sort((a, b) => sign * compareHomeItems(a, b));
  if (key === "downloaded") {
    // Three groups in a fixed order whatever the direction: recorded imports, then file dates, then no date at all.
    // Within the first two groups the date sorts in the chosen direction.
    return [...items].sort((a, b) => {
      const ga = downloadGroup(a);
      const gb = downloadGroup(b);
      if (ga.group !== gb.group) return ga.group - gb.group;
      if (ga.time === null || gb.time === null) return compareHomeItems(a, b);
      return sign * (ga.time - gb.time) || compareHomeItems(a, b);
    });
  }
  return [...items].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null || vb === null) {
      if (va === null && vb === null) return compareHomeItems(a, b);
      return va === null ? 1 : -1;
    }
    if (va !== vb) return sign * (va - vb);
    return compareHomeItems(a, b);
  });
}

/** Where the Home grid remembers its sort choice. */
export const HOME_SORT_KEY = "mediahub.homeSort";

/** The sort the grid starts with, and the one used when a saved choice is missing or invalid. */
export const DEFAULT_HOME_SORT: { key: HomeSortKey; dir: HomeSortDir } = { key: "title", dir: "asc" };

/**
 * The saved sort, or the default when nothing is saved, the stored text isn't JSON, or it names an unknown sort or
 * direction. Storage can be missing or throw (private mode), which also gives the default.
 */
export function readHomeSort(): { key: HomeSortKey; dir: HomeSortDir } {
  try {
    const parsed: unknown = JSON.parse(readChoice(HOME_SORT_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_HOME_SORT;
    const { key, dir } = parsed as Record<string, unknown>;
    const validKey = HOME_SORTS.find((sort) => sort.key === key);
    if (!validKey || (dir !== "asc" && dir !== "desc")) return DEFAULT_HOME_SORT;
    return { key: validKey.key, dir };
  } catch {
    return DEFAULT_HOME_SORT;
  }
}

/** Saves the sort choice. Storage can be missing or throw, in which case the choice is simply not remembered. */
export function saveHomeSort(choice: { key: HomeSortKey; dir: HomeSortDir }): void {
  writeChoice(HOME_SORT_KEY, JSON.stringify(choice));
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

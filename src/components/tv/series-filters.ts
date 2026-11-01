// Pure filtering, sorting and paging for the TV table. Must not import from src/server at runtime.
import type { QualityProfileOption } from "@/server/arr/movies";
import type { SeriesRow, SeriesStatus } from "@/server/arr/series";

export const PAGE_SIZE = 100;

export type StatusFilter = "all" | SeriesStatus;
export type MonitoredFilter = "all" | "monitored" | "unmonitored";
export type ProfileFilter = "all" | number;
/** "missing" means fewer episode files than Sonarr expects (episodeFileCount < episodeCount). */
export type MissingFilter = "all" | "complete" | "missing";

export type SeriesFilters = {
  search: string;
  status: StatusFilter;
  monitored: MonitoredFilter;
  profileId: ProfileFilter;
  missing: MissingFilter;
};

export const DEFAULT_FILTERS: SeriesFilters = {
  search: "",
  status: "all",
  monitored: "all",
  profileId: "all",
  missing: "all",
};

export type SortKey = "title" | "year" | "episodes" | "size" | "added";
export type SortDir = "asc" | "desc";
export type SortState = { key: SortKey; dir: SortDir };

export const DEFAULT_SORT: SortState = { key: "title", dir: "asc" };

// The direction a column starts in when it is first clicked. Episodes starts ascending, so the least complete
// series come first. The others start with the newest and largest first.
const FIRST_DIR: Record<SortKey, SortDir> = { title: "asc", year: "desc", episodes: "asc", size: "desc", added: "desc" };

export function hasActiveFilters(filters: SeriesFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.status !== "all" ||
    filters.monitored !== "all" ||
    filters.profileId !== "all" ||
    filters.missing !== "all"
  );
}

/** True when Sonarr has fewer episode files than it expects. */
export function isMissing(row: SeriesRow): boolean {
  return row.episodeFileCount < row.episodeCount;
}

/**
 * Share of expected episodes that are on disk, from 0 to 1. A series expecting no episodes counts as complete,
 * and more files than expected also counts as complete.
 */
export function episodeFraction(row: SeriesRow): number {
  if (row.episodeCount <= 0) return 1;
  return Math.min(row.episodeFileCount / row.episodeCount, 1);
}

/** Case-insensitive substring match on the title or the year. An empty query matches everything. */
export function matchesSearch(row: SeriesRow, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (query === "") return true;
  if (row.title.toLowerCase().includes(query)) return true;
  return row.year !== null && String(row.year).includes(query);
}

export function filterSeries(rows: SeriesRow[], filters: SeriesFilters): SeriesRow[] {
  return rows.filter(
    (row) =>
      matchesSearch(row, filters.search) &&
      (filters.status === "all" || row.status === filters.status) &&
      (filters.monitored === "all" || row.monitored === (filters.monitored === "monitored")) &&
      (filters.profileId === "all" || row.qualityProfileId === filters.profileId) &&
      (filters.missing === "all" || isMissing(row) === (filters.missing === "missing")),
  );
}

type SortValue = string | number | null;

// Fixed locale so the server render and the browser sort identically. Handles accents ("Éclair" before "Zulu").
const TITLE_COLLATOR = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function addedTime(iso: string | null): number | null {
  if (iso === null) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

function sortValue(row: SeriesRow, key: SortKey): SortValue {
  switch (key) {
    case "title":
      return row.sortTitle;
    case "year":
      return row.year;
    case "episodes":
      return episodeFraction(row);
    case "size":
      // No files means no size: sort it with the missing values, not as the smallest.
      return row.sizeOnDisk > 0 ? row.sizeOnDisk : null;
    case "added":
      return addedTime(row.added);
  }
}

/** Compares two values in the given direction. Missing values (null) always sort last. */
function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  const sign = dir === "asc" ? 1 : -1;
  if (typeof a === "string" && typeof b === "string") {
    return TITLE_COLLATOR.compare(a, b) * sign;
  }
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * sign;
  }
  return 0;
}

/** Returns a new array sorted by the given column. Ties fall back to the title, then id. */
export function sortSeries(rows: SeriesRow[], sort: SortState): SeriesRow[] {
  return [...rows].sort((a, b) => {
    const primary = compareValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir);
    if (primary !== 0) return primary;
    return TITLE_COLLATOR.compare(a.sortTitle, b.sortTitle) || a.id - b.id;
  });
}

/** Clicking the active column flips its direction. Clicking another column starts at that column's first direction. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: FIRST_DIR[key] };
}

/**
 * Profile filter options: Sonarr's profiles, plus one option per profile id that rows use but
 * Sonarr no longer lists (e.g. the profile was deleted), labelled exactly as the rows show it.
 */
export function profileOptions(rows: SeriesRow[], profiles: QualityProfileOption[]): QualityProfileOption[] {
  const known = new Set(profiles.map((p) => p.id));
  const orphans = new Map<number, string>();
  for (const row of rows) {
    if (!known.has(row.qualityProfileId)) orphans.set(row.qualityProfileId, row.qualityProfile);
  }
  const extra = [...orphans].sort(([a], [b]) => a - b).map(([id, name]) => ({ id, name }));
  return [...profiles, ...extra];
}

/** Number of pages for a total. There is always at least one page, even when empty. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** Keeps a page number within 1..pageCount(total). Non-numeric input becomes page 1. */
export function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), pageCount(total));
}

/** The items on one page. The page number is clamped first, so a stale page never returns an empty slice. */
export function pageSlice<T>(items: T[], page: number): T[] {
  const current = clampPage(page, items.length);
  return items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
}

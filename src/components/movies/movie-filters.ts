// Pure filtering, sorting and paging for the Movies table. Must not import from src/server at runtime.
import type { MovieRow, MovieStatus, QualityProfileOption } from "@/server/arr/movies";

export const PAGE_SIZE = 100;

export type StatusFilter = "all" | MovieStatus;
export type MonitoredFilter = "all" | "monitored" | "unmonitored";
export type ProfileFilter = "all" | number;

export type MovieFilters = {
  search: string;
  status: StatusFilter;
  monitored: MonitoredFilter;
  profileId: ProfileFilter;
};

export const DEFAULT_FILTERS: MovieFilters = {
  search: "",
  status: "all",
  monitored: "all",
  profileId: "all",
};

export type SortKey = "title" | "year" | "size" | "added";
export type SortDir = "asc" | "desc";
export type SortState = { key: SortKey; dir: SortDir };

export const DEFAULT_SORT: SortState = { key: "title", dir: "asc" };

// The direction a column starts in when it is first clicked: newest and largest first.
const FIRST_DIR: Record<SortKey, SortDir> = { title: "asc", year: "desc", size: "desc", added: "desc" };

export function hasActiveFilters(filters: MovieFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.status !== "all" ||
    filters.monitored !== "all" ||
    filters.profileId !== "all"
  );
}

/** Case-insensitive substring match on the title or the year. An empty query matches everything. */
export function matchesSearch(row: MovieRow, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (query === "") return true;
  if (row.title.toLowerCase().includes(query)) return true;
  return row.year !== null && String(row.year).includes(query);
}

export function filterMovies(rows: MovieRow[], filters: MovieFilters): MovieRow[] {
  return rows.filter(
    (row) =>
      matchesSearch(row, filters.search) &&
      (filters.status === "all" || row.status === filters.status) &&
      (filters.monitored === "all" || row.monitored === (filters.monitored === "monitored")) &&
      (filters.profileId === "all" || row.qualityProfileId === filters.profileId),
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

function sortValue(row: MovieRow, key: SortKey): SortValue {
  switch (key) {
    case "title":
      return row.sortTitle;
    case "year":
      return row.year;
    case "size":
      // No file means no size: sort it with the missing values, not as the smallest.
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
export function sortMovies(rows: MovieRow[], sort: SortState): MovieRow[] {
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
 * Profile filter options: Radarr's profiles, plus one option per profile id that rows use but
 * Radarr no longer lists (e.g. the profile was deleted), labelled exactly as the rows show it.
 */
export function profileOptions(rows: MovieRow[], profiles: QualityProfileOption[]): QualityProfileOption[] {
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

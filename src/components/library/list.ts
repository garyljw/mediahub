// Shared paging, sorting and filter-option logic for the library tables. Must not import from src/server at runtime.
import type { QualityProfileOption } from "@/server/arr/profiles";

export const PAGE_SIZE = 100;

export type MonitoredFilter = "all" | "monitored" | "unmonitored";
export type ProfileFilter = "all" | number;

export type SortDir = "asc" | "desc";
export type SortValue = string | number | null;

// Fixed locale so the server render and the browser sort identically. Handles accents ("Éclair" before "Zulu").
export const TITLE_COLLATOR = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * The library search rule, shared by the Movies and TV tables and the Home grid: a case-insensitive substring
 * of the title, or of the year. An empty query matches everything.
 */
export function matchesTitleOrYear(item: { title: string; year: number | null }, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (query === "") return true;
  if (item.title.toLowerCase().includes(query)) return true;
  return item.year !== null && String(item.year).includes(query);
}

/** A date-time as milliseconds, or null when it is missing or unparseable. */
export function addedTime(iso: string | null): number | null {
  if (iso === null) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

/** Compares two values in the given direction. Missing values (null) always sort last. */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
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

/**
 * Clicking the active column flips its direction. Clicking another column starts at that column's first
 * direction, from `firstDir`.
 */
export function nextSort<K extends string>(
  current: { key: K; dir: SortDir },
  key: K,
  firstDir: Record<K, SortDir>,
): { key: K; dir: SortDir } {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: firstDir[key] };
}

/**
 * Returns a new array sorted by the given column. `sortValue` gives each row's value for the column; it is
 * computed once per row, not once per comparison. Ties fall back to the title (collated), then id.
 */
export function sortRows<T extends { sortTitle: string; id: number }, K>(
  rows: T[],
  sort: { key: K; dir: SortDir },
  sortValue: (row: T, key: K) => SortValue,
): T[] {
  const decorated = rows.map((row) => ({ row, value: sortValue(row, sort.key) }));
  decorated.sort((a, b) => {
    const primary = compareValues(a.value, b.value, sort.dir);
    if (primary !== 0) return primary;
    return TITLE_COLLATOR.compare(a.row.sortTitle, b.row.sortTitle) || a.row.id - b.row.id;
  });
  return decorated.map((entry) => entry.row);
}

/**
 * Profile filter options: the Arr's profiles, plus one option per profile id that rows use but the Arr
 * no longer lists (e.g. the profile was deleted), labelled exactly as the rows show it.
 */
export function profileOptions(
  rows: { qualityProfileId: number; qualityProfile: string }[],
  profiles: QualityProfileOption[],
): QualityProfileOption[] {
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

// Pure filtering and sorting for the TV table. Must not import from src/server at runtime.
import type { SeriesRow, SeriesStatus } from "@/server/arr/series";
import {
  addedTime,
  sortRows,
  type MonitoredFilter,
  type ProfileFilter,
  type SortDir,
  type SortValue,
  matchesTitleOrYear,
} from "@/components/library/list";

export type StatusFilter = "all" | SeriesStatus;
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
export type SortState = { key: SortKey; dir: SortDir };

export const DEFAULT_SORT: SortState = { key: "title", dir: "asc" };

// The direction a column starts in when it is first clicked. Episodes starts ascending, so the least complete
// series come first. The others start with the newest and largest first.
export const FIRST_DIR: Record<SortKey, SortDir> = { title: "asc", year: "desc", episodes: "asc", size: "desc", added: "desc" };

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
  return matchesTitleOrYear(row, search);
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

/** Returns a new array sorted by the given column. Ties fall back to the title, then id. */
export function sortSeries(rows: SeriesRow[], sort: SortState): SeriesRow[] {
  return sortRows(rows, sort, sortValue);
}

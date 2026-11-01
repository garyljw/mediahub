// Pure filtering and sorting for the Movies table. Must not import from src/server at runtime.
import type { MovieRow, MovieStatus } from "@/server/arr/movies";
import {
  addedTime,
  sortRows,
  type MonitoredFilter,
  type ProfileFilter,
  type SortDir,
  type SortValue,
} from "@/components/library/list";

export type StatusFilter = "all" | MovieStatus;

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
export type SortState = { key: SortKey; dir: SortDir };

export const DEFAULT_SORT: SortState = { key: "title", dir: "asc" };

// The direction a column starts in when it is first clicked: newest and largest first.
export const FIRST_DIR: Record<SortKey, SortDir> = { title: "asc", year: "desc", size: "desc", added: "desc" };

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

/** Returns a new array sorted by the given column. Ties fall back to the title, then id. */
export function sortMovies(rows: MovieRow[], sort: SortState): MovieRow[] {
  return sortRows(rows, sort, sortValue);
}

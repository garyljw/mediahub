import type { CalendarEntry, ReleaseType } from "@/server/merge/calendar";

// Pure filter and grouping logic for the Calendar page. The page filters in the browser, so toggling a filter
// never refetches.

/** The cookie that remembers the chosen view. Read on the server so the first render already uses it. */
export const CALENDAR_VIEW_COOKIE = "mediahub-calendar-view";
export const CALENDAR_VIEWS = ["list", "grid"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const RELEASE_TYPES: readonly ReleaseType[] = ["cinema", "digital", "physical"];

/** One day of the range, with its label computed on the server. */
export type CalendarDay = { date: string; label: string; isToday: boolean };

export type TypeFilter = "all" | "movies" | "tv";

export type CalendarFilters = {
  type: TypeFilter;
  /** The movie release types to show. Episodes are not affected. */
  releaseTypes: ReleaseType[];
  showUnmonitored: boolean;
};

export const DEFAULT_FILTERS: CalendarFilters = {
  type: "all",
  releaseTypes: [...RELEASE_TYPES],
  showUnmonitored: false,
};

/** The entries that pass the filters, in their original order. */
export function filterEntries(entries: CalendarEntry[], filters: CalendarFilters): CalendarEntry[] {
  return entries.filter((entry) => {
    if (filters.type === "movies" && entry.kind !== "movie") return false;
    if (filters.type === "tv" && entry.kind !== "episode") return false;
    if (entry.releaseType !== null && !filters.releaseTypes.includes(entry.releaseType)) return false;
    if (!filters.showUnmonitored && entry.status === "unmonitored") return false;
    return true;
  });
}

/** Entries grouped by their "YYYY-MM-DD" date. Each day keeps the order it had in the input. */
export function entriesByDate(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const groups = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.date);
    if (list) list.push(entry);
    else groups.set(entry.date, [entry]);
  }
  return groups;
}

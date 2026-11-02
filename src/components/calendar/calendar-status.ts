import type { CalendarStatus } from "@/server/merge/calendar";

// Calendar status labels. "Upcoming" covers a movie release date still ahead and an episode not yet aired.
// "Not available" is a passed movie release date while Radarr's isAvailable flag is still false.
export const CALENDAR_STATUS_LABEL: Record<CalendarStatus, string> = {
  downloaded: "Downloaded",
  missing: "Missing",
  upcoming: "Upcoming",
  notAvailable: "Not available",
  unmonitored: "Unmonitored",
};

// Badge colours match the TV episode badges: downloaded reads as present, missing as needed, the rest are muted.
export const CALENDAR_STATUS_CLASS: Record<CalendarStatus, string> = {
  downloaded: "border-transparent bg-emerald-600/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  missing: "border-transparent bg-amber-500/20 text-amber-800 dark:text-amber-300",
  upcoming: "border-transparent bg-muted text-muted-foreground",
  notAvailable: "border-muted-foreground/40 bg-transparent text-muted-foreground",
  unmonitored: "border-transparent bg-muted text-muted-foreground",
};

// The grid's one-line chips. Same hues as the badges above, lighter so a dense cell stays readable.
// Every chip has a border so the sizes match; only "not available" shows it.
export const CALENDAR_STATUS_CHIP: Record<CalendarStatus, string> = {
  downloaded: "border-transparent bg-emerald-600/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  missing: "border-transparent bg-amber-500/20 text-amber-800 dark:text-amber-300",
  upcoming: "border-transparent bg-muted text-muted-foreground",
  notAvailable: "border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground",
  unmonitored: "border-transparent bg-muted text-muted-foreground opacity-60",
};

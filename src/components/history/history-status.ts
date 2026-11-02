import type { HistoryEvent } from "@/server/merge/history";

// Event labels for the History table. "Other" covers an event type this page doesn't name (Radarr or Sonarr's
// Unknown event), so no claim is made about what it means.
export const HISTORY_EVENT_LABEL: Record<HistoryEvent, string> = {
  grabbed: "Grabbed",
  imported: "Imported",
  failed: "Failed",
  deleted: "Deleted",
  renamed: "Renamed",
  ignored: "Ignored",
  unknown: "Other",
};

// Badge colours follow the calendar's status badges: imported reads as present, failed as a problem, grabbed as in
// progress, and the rest are muted.
export const HISTORY_EVENT_CLASS: Record<HistoryEvent, string> = {
  grabbed: "border-transparent bg-sky-600/15 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  imported: "border-transparent bg-emerald-600/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  failed: "border-transparent bg-destructive/15 text-destructive",
  deleted: "border-transparent bg-muted text-muted-foreground",
  renamed: "border-transparent bg-muted text-muted-foreground",
  ignored: "border-transparent bg-muted text-muted-foreground",
  unknown: "border-transparent bg-muted text-muted-foreground",
};

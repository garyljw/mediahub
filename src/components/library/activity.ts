// Pure display logic for the Activity column. Must not import from src/server at runtime.
import type { ActivityState, QueueActivity } from "@/server/arr/activity";
import { formatEta } from "@/components/library/format";

/** How often the browser asks for queue state, while the tab is visible. */
export const ACTIVITY_POLL_MS = 10_000;
/** Longer than the server's 15 s upstream timeout, so a slow but live reply is never cut short by the browser. */
export const ACTIVITY_TIMEOUT_MS = 20_000;

const BASE_LABEL: Record<ActivityState, string> = {
  queued: "Queued",
  downloading: "Downloading",
  paused: "Paused",
  delayed: "Delayed",
  importPending: "Waiting to import",
  importing: "Importing",
  importBlocked: "Import blocked",
  failed: "Download failed",
  clientUnavailable: "Download client unavailable",
  unknown: "In queue",
};

/**
 * True for a downloading or paused item whose progress is known. Only these show a percent and a bar.
 * The type guard lets callers read `progress` as a number once this is true.
 */
export function showsProgress(activity: QueueActivity): activity is QueueActivity & { progress: number } {
  return (activity.state === "downloading" || activity.state === "paused") && activity.progress !== null;
}

/** The text shown beside the icon, e.g. "Downloading 75% · 1h 5m (+1 more)". */
export function activityLabel(activity: QueueActivity): string {
  let label = BASE_LABEL[activity.state];
  if (showsProgress(activity)) label += ` ${activity.progress}%`;
  if (activity.state === "downloading") {
    const eta = formatEta(activity.etaSeconds);
    if (eta !== null) label += ` · ${eta}`;
  }
  if (activity.count > 1) label += ` (+${activity.count - 1} more)`;
  return label;
}

/** Index the poll result by row id (movie id, series id or episode id) for the table rows. */
export function activityById(items: QueueActivity[]): Map<number, QueueActivity> {
  return new Map(items.map((activity) => [activity.id, activity]));
}

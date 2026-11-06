"use client";

import { AlertTriangle, Clock, Download, Pause } from "lucide-react";
import { TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ActivitySeverity, ActivityState, QueueActivity } from "@/server/arr/activity";
import { CELL } from "@/components/library/table-parts";
import { activityLabel, showsProgress } from "@/components/library/activity";

/** Text colour for each Activity severity. Warning reuses the amber of the "Missing" badge. */
export const ACTIVITY_CLASS: Record<ActivitySeverity, string> = {
  ok: "text-muted-foreground",
  warning: "text-amber-800 dark:text-amber-300",
  error: "text-destructive",
};

/** One icon per activity state. Download and pause are the two that show progress. */
export const ACTIVITY_ICON: Record<ActivityState, typeof Clock> = {
  queued: Clock,
  delayed: Clock,
  importPending: Clock,
  importing: Clock,
  unknown: Clock,
  downloading: Download,
  paused: Pause,
  importBlocked: AlertTriangle,
  failed: AlertTriangle,
  clientUnavailable: AlertTriangle,
};

/**
 * One row's Activity cell: an icon and label, a progress bar while downloading or paused, and the first
 * message. Admins get messages; requesters never do, so for them the cell only shows state. `name` labels
 * the progress bar for screen readers.
 */
export function ActivityCell({ name, activity }: { name: string; activity: QueueActivity | undefined }) {
  if (!activity) return <TableCell className={CELL} />;
  const Icon = ACTIVITY_ICON[activity.state];
  // The label can be cut off in the cell, so the hover text always has it. Messages (admins only) follow it.
  const tooltip = [activityLabel(activity), ...activity.messages].join("\n");
  return (
    <TableCell className={cn(CELL, "whitespace-normal min-w-48")} title={tooltip}>
      <span className={cn("flex min-w-0 items-center gap-1.5", ACTIVITY_CLASS[activity.severity])}>
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{activityLabel(activity)}</span>
      </span>
      {showsProgress(activity) && (
        <div
          role="progressbar"
          aria-label={`Download progress for ${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={activity.progress}
          className="mt-1 h-1 w-24 overflow-hidden rounded bg-muted"
        >
          <div className="h-full bg-brand" style={{ width: `${activity.progress}%` }} />
        </div>
      )}
      {activity.messages.length > 0 && (
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{activity.messages[0]}</p>
      )}
    </TableCell>
  );
}

/**
 * The content of the Activity column header. When the last poll failed, a warning icon and screen-reader
 * text say the column may be stale. `source` names the app, e.g. "Radarr".
 */
export function ActivityHead({ failed, source }: { failed: boolean; source: string }) {
  const message = `Couldn't update activity from ${source}`;
  return (
    <span className="inline-flex items-center gap-1">
      Activity
      {failed && (
        <span title={message} className="inline-flex">
          <AlertTriangle aria-hidden className="size-3.5 text-amber-800 dark:text-amber-300" />
        </span>
      )}
      {failed && <span className="sr-only">{message}</span>}
    </span>
  );
}

"use client";

import { AlertTriangle } from "lucide-react";
import { ACTIVITY_CLASS, ACTIVITY_ICON } from "@/components/library/activity-cell";
import { activityLabel, showsProgress } from "@/components/library/activity";
import { useActivity } from "@/components/library/use-activity";
import { cn } from "@/lib/utils";

/**
 * This movie's live Radarr queue state, polled from the browser like the other activity indicators. Renders nothing
 * while the movie isn't in the queue, and a warning when the last poll failed. Empty until the first reply, so the
 * server render and the first browser render match.
 */
export function MovieActivity({ movieId, title }: { movieId: number; title: string }) {
  const { byId, failed } = useActivity("/api/movies/activity");
  const activity = byId.get(movieId);

  if (activity === undefined) {
    if (!failed) return null;
    return (
      <p role="status" className="inline-flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
        <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
        Couldn&apos;t update activity from Radarr.
      </p>
    );
  }

  const Icon = ACTIVITY_ICON[activity.state];
  return (
    <div className="space-y-1 text-sm">
      <p className={cn("flex min-w-0 items-center gap-1.5", ACTIVITY_CLASS[activity.severity])}>
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span>{activityLabel(activity)}</span>
      </p>
      {showsProgress(activity) && (
        <div
          role="progressbar"
          aria-label={`Download progress for ${title}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={activity.progress}
          className="h-1 w-48 overflow-hidden rounded bg-muted"
        >
          <div className="h-full bg-primary" style={{ width: `${activity.progress}%` }} />
        </div>
      )}
      {activity.messages.length > 0 && <p className="text-xs text-muted-foreground">{activity.messages[0]}</p>}
    </div>
  );
}

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { ACTIVITY_CLASS, ACTIVITY_ICON, ActivityCell, ActivityHead } from "@/components/library/activity-cell";
import { formatCount } from "@/components/library/format";
import { useActivity, type ActivityResult } from "@/components/library/use-activity";
import { cn } from "@/lib/utils";
import { seasonActivitySummary } from "./season-activity";

// Used only when a component is rendered outside the provider, which the series page never does.
const EMPTY: ActivityResult = { byId: new Map(), failed: false };
const SeriesActivityContext = createContext<ActivityResult>(EMPTY);

/**
 * Polls the queue for one series, once, and shares the result with the season and episode pieces below it.
 * Empty until the first reply, so the server render and the first browser render match.
 */
export function SeriesActivityProvider({ seriesId, children }: { seriesId: number; children: ReactNode }) {
  const activity = useActivity(`/api/tv/${seriesId}/activity`);
  return <SeriesActivityContext.Provider value={activity}>{children}</SeriesActivityContext.Provider>;
}

/** One episode row's Activity cell. `name` labels its progress bar, e.g. "Season 1 episode 4". */
export function EpisodeActivityCell({ episodeId, name }: { episodeId: number; name: string }) {
  const { byId } = useContext(SeriesActivityContext);
  return <ActivityCell name={name} activity={byId.get(episodeId)} />;
}

/** The Activity column header for an episode table. */
export function EpisodeActivityHead() {
  const { failed } = useContext(SeriesActivityContext);
  return <ActivityHead failed={failed} source="Sonarr" />;
}

/**
 * The season header's "N in queue" marker. Renders nothing when none of the season's episodes is queued.
 * Coloured and iconed by the worst queued episode.
 */
export function SeasonActivitySummary({ episodeIds, label }: { episodeIds: number[]; label: string }) {
  const { byId } = useContext(SeriesActivityContext);
  const summary = seasonActivitySummary(byId, episodeIds);
  if (summary === null) return null;
  const Icon = ACTIVITY_ICON[summary.state];
  const episodes = summary.count === 1 ? "episode" : "episodes";
  return (
    <span
      title={`${label}: ${formatCount(summary.count)} ${episodes} in the Sonarr queue`}
      className={cn("inline-flex items-center gap-1 tabular-nums", ACTIVITY_CLASS[summary.severity])}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {formatCount(summary.count)} in queue
    </span>
  );
}

/**
 * The series hero's queue line, counting every episode of the series. Renders nothing while none of them is queued,
 * and a warning when the last poll failed. Takes its colour and icon from the worst queued episode, like the season line.
 */
export function SeriesActivitySummary({ episodeIds, title }: { episodeIds: number[]; title: string }) {
  const { byId, failed } = useContext(SeriesActivityContext);
  const summary = seasonActivitySummary(byId, episodeIds);

  if (summary === null) {
    if (!failed) return null;
    return (
      <p role="status" className="inline-flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
        <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
        Couldn&apos;t update activity from Sonarr.
      </p>
    );
  }

  const Icon = ACTIVITY_ICON[summary.state];
  const episodes = summary.count === 1 ? "episode" : "episodes";
  return (
    <p
      title={`${title}: ${formatCount(summary.count)} ${episodes} in the Sonarr queue`}
      className={cn("inline-flex items-center gap-1.5 text-sm tabular-nums", ACTIVITY_CLASS[summary.severity])}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span>{`${formatCount(summary.count)} ${episodes} in the queue`}</span>
    </p>
  );
}

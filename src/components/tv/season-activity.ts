// Pure summary of a season's queue activity for its header line. Must not import from src/server at runtime.
import type { ActivitySeverity, ActivityState, QueueActivity } from "@/server/arr/activity";
import { SEVERITY_RANK } from "@/components/library/severity";

export type SeasonActivitySummary = {
  /** Episodes in this season that are in the queue. */
  count: number;
  /** The worst severity among those episodes. */
  severity: ActivitySeverity;
  /** The state of the worst episode. The first episode in season order wins a tie. */
  state: ActivityState;
};

/**
 * Counts the season's episodes that are in the queue, and takes the colour and icon from the worst one.
 * Returns null when none of the season's episodes is in the queue, so the header shows nothing.
 */
export function seasonActivitySummary(
  byId: Map<number, QueueActivity>,
  episodeIds: number[],
): SeasonActivitySummary | null {
  let count = 0;
  let worst: QueueActivity | null = null;
  for (const episodeId of episodeIds) {
    const activity = byId.get(episodeId);
    if (!activity) continue;
    count += 1;
    if (worst === null || SEVERITY_RANK[activity.severity] > SEVERITY_RANK[worst.severity]) worst = activity;
  }
  if (worst === null) return null;
  return { count, severity: worst.severity, state: worst.state };
}

// Pure edit-payload logic for the TV table. Must not import from src/server at runtime.
import type { SeriesEdit } from "@/server/arr/series";
import type { MonitorChoice } from "@/components/library/edit";

/** Largest bulk edit the server accepts (src/app/(app)/tv/actions.ts uses this same value). */
export const MAX_EDIT_SERIES = 2000;

/**
 * The bulk edit to send, or null when nothing would change (or there is nothing to change).
 * Fields left at "Keep current" are omitted, so the server never sees a no-op field.
 */
export function buildEditPayload(
  seriesIds: readonly number[],
  profileId: number | null,
  monitor: MonitorChoice,
): SeriesEdit | null {
  if (seriesIds.length === 0) return null;
  const edit: SeriesEdit = { seriesIds: [...seriesIds] };
  if (profileId !== null) edit.qualityProfileId = profileId;
  if (monitor !== "keep") edit.monitored = monitor === "monitored";
  return edit.qualityProfileId === undefined && edit.monitored === undefined ? null : edit;
}

// Pure edit-payload logic for the Movies table. Must not import from src/server at runtime.
import type { MovieEdit } from "@/server/arr/movies";
import type { MonitorChoice } from "@/components/library/edit";

/** Largest bulk edit the server accepts (src/app/(app)/movies/actions.ts uses this same value). */
export const MAX_EDIT_MOVIES = 2000;

/**
 * The bulk edit to send, or null when nothing would change (or there is nothing to change).
 * Fields left at "Keep current" are omitted, so the server never sees a no-op field.
 */
export function buildEditPayload(
  movieIds: readonly number[],
  profileId: number | null,
  monitor: MonitorChoice,
): MovieEdit | null {
  if (movieIds.length === 0) return null;
  const edit: MovieEdit = { movieIds: [...movieIds] };
  if (profileId !== null) edit.qualityProfileId = profileId;
  if (monitor !== "keep") edit.monitored = monitor === "monitored";
  return edit.qualityProfileId === undefined && edit.monitored === undefined ? null : edit;
}

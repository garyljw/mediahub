// Pure delete-dialog logic for the TV table. Must not import from src/server at runtime.
import { DELETE_LIST_LIMIT } from "@/components/movies/movie-delete";

/** The parts of a series row the delete dialog shows. */
export type DeleteSeries = { title: string; year: number | null };

/** Dialog title: "Delete <title>?" for one series, otherwise "Delete N series?". */
export function deleteTitle(series: readonly DeleteSeries[]): string {
  const only = series[0];
  if (series.length === 1 && only) return `Delete ${only.title}?`;
  return `Delete ${series.length} series?`;
}

/** "Title (Year)", or just the title when the year is unknown. */
export function seriesLabel(series: DeleteSeries): string {
  return series.year === null ? series.title : `${series.title} (${series.year})`;
}

/**
 * The lines the dialog lists: the first DELETE_LIST_LIMIT series, and an "and N more" line when
 * there are more. `more` is null when nothing was left out.
 */
export function listedSeries(series: readonly DeleteSeries[]): { shown: string[]; more: string | null } {
  const hidden = Math.max(0, series.length - DELETE_LIST_LIMIT);
  return {
    shown: series.slice(0, DELETE_LIST_LIMIT).map(seriesLabel),
    more: hidden > 0 ? `and ${hidden} more` : null,
  };
}

/** Confirm button text: "Delete series" / "Delete N series", with " and files" when files are deleted too. */
export function confirmLabel(count: number, deleteFiles: boolean): string {
  const noun = count === 1 ? "series" : `${count} series`;
  return `Delete ${noun}${deleteFiles ? " and files" : ""}`;
}

/** The status line after a successful delete. */
export function deletedMessage(seriesCount: number): string {
  return `Deleted ${seriesCount} series`;
}

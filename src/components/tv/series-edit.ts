// Pure edit logic for the series page's settings form. Must not import from src/server at runtime (type imports are fine).
// The option lists live here or in series-add.ts, so the server's Zod schema and the form share one source.
import type { components as SonarrComponents } from "@/server/arr/generated/sonarr";
import type { SeriesEdit } from "@/server/arr/series";
import { SERIES_TYPE_OPTIONS, type SeriesTypeOption } from "./series-add";

type NewItemMonitorTypes = SonarrComponents["schemas"]["NewItemMonitorTypes"];

/** A series type the form and the server accept. The same three values the add dialog offers (a Sonarr SeriesTypes value each). */
export type SeriesType = SeriesTypeOption;

/** The values for "Monitor new seasons". Each one is a Sonarr NewItemMonitorTypes value (checked at compile time). */
export const NEW_ITEM_MONITOR_OPTIONS = ["all", "none"] as const satisfies readonly NewItemMonitorTypes[];
export type NewItemMonitor = (typeof NEW_ITEM_MONITOR_OPTIONS)[number];

export const NEW_ITEM_MONITOR_LABELS: Record<NewItemMonitor, string> = {
  all: "All",
  none: "None",
};

/** True for a series type the form offers. Anything else from Sonarr shows as unknown. */
export function isSeriesType(value: unknown): value is SeriesType {
  return (SERIES_TYPE_OPTIONS as readonly unknown[]).includes(value);
}

/** True for a "Monitor new seasons" value the form offers. Anything else from Sonarr shows as unknown. */
export function isNewItemMonitor(value: unknown): value is NewItemMonitor {
  return (NEW_ITEM_MONITOR_OPTIONS as readonly unknown[]).includes(value);
}

/** The values the form edits. A null type or monitor value means Sonarr sent one the form doesn't offer. */
export type SeriesFormValues = {
  qualityProfileId: number;
  monitored: boolean;
  seriesType: SeriesType | null;
  seasonFolder: boolean;
  monitorNewItems: NewItemMonitor | null;
};

/**
 * The edit to send: only the fields where `next` differs from `current`, plus the series id. Null when nothing
 * differs. The form can't choose "no value", so a null type or monitor value is never sent back.
 */
export function buildSeriesEdit(seriesId: number, current: SeriesFormValues, next: SeriesFormValues): SeriesEdit | null {
  const edit: SeriesEdit = { seriesId };
  let changed = false;
  if (next.qualityProfileId !== current.qualityProfileId) {
    edit.qualityProfileId = next.qualityProfileId;
    changed = true;
  }
  if (next.monitored !== current.monitored) {
    edit.monitored = next.monitored;
    changed = true;
  }
  if (next.seriesType !== null && next.seriesType !== current.seriesType) {
    edit.seriesType = next.seriesType;
    changed = true;
  }
  if (next.seasonFolder !== current.seasonFolder) {
    edit.seasonFolder = next.seasonFolder;
    changed = true;
  }
  if (next.monitorNewItems !== null && next.monitorNewItems !== current.monitorNewItems) {
    edit.monitorNewItems = next.monitorNewItems;
    changed = true;
  }
  return changed ? edit : null;
}

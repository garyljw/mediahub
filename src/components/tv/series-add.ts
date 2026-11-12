// The Sonarr option lists for a series: monitor and series type. Used by the server's Zod schemas, Settings and the
// series edit form. Must not import from src/server at runtime (type imports are fine).
import type { components as SonarrComponents } from "@/server/arr/generated/sonarr";

type MonitorTypes = SonarrComponents["schemas"]["MonitorTypes"];
type SeriesTypes = SonarrComponents["schemas"]["SeriesTypes"];

/**
 * The monitor choices the dialog offers. Each one is a Sonarr MonitorTypes value (checked at compile time), so
 * the server can send it straight to Sonarr as addOptions.monitor.
 */
export const SERIES_MONITOR_OPTIONS = ["all", "future", "missing", "existing", "firstSeason", "latestSeason", "none"] as const satisfies readonly MonitorTypes[];
export type SeriesMonitor = (typeof SERIES_MONITOR_OPTIONS)[number];

/** The series types the dialog offers. Each one is a Sonarr SeriesTypes value (checked at compile time). */
export const SERIES_TYPE_OPTIONS = ["standard", "daily", "anime"] as const satisfies readonly SeriesTypes[];
export type SeriesTypeOption = (typeof SERIES_TYPE_OPTIONS)[number];

export const MONITOR_LABELS: Record<SeriesMonitor, string> = {
  all: "All episodes",
  future: "Future episodes",
  missing: "Missing episodes",
  existing: "Existing episodes",
  firstSeason: "First season",
  latestSeason: "Latest season",
  none: "None",
};

/** One line per monitor preset, for the series settings form. Each is what Sonarr does to the series' episodes. */
export const MONITOR_HINTS: Record<SeriesMonitor, string> = {
  all: "Monitors every episode except specials.",
  future: "Monitors episodes that haven't aired yet and unmonitors the rest, specials included.",
  missing: "Monitors episodes without a file and unmonitors the rest, specials included.",
  existing: "Monitors episodes with a file and unmonitors the rest, specials included.",
  firstSeason: "Monitors only the first season.",
  latestSeason: "Monitors only the latest season.",
  none: "Unmonitors every episode and the series itself.",
};

export const SERIES_TYPE_LABELS: Record<SeriesTypeOption, string> = {
  standard: "Standard",
  daily: "Daily",
  anime: "Anime",
};

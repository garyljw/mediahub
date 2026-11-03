// Pure logic for the Add series dialog. Must not import from src/server at runtime (type imports are fine).
// The option lists live here so the server's Zod schema and the dialog share one source.
import type { components as SonarrComponents } from "@/server/arr/generated/sonarr";
import type { SeriesLookupResult } from "@/server/arr/series-add";
import type { RootFolderOption } from "@/server/arr/root-folders";
import type { QualityProfileOption } from "@/server/arr/profiles";

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

export const SERIES_TYPE_LABELS: Record<SeriesTypeOption, string> = {
  standard: "Standard",
  daily: "Daily",
  anime: "Anime",
};

/** The dialog's options. They apply to whichever result the admin or requester clicks Add on. */
export type SeriesAddOptions = {
  profileId: number | null;
  rootFolderId: number | null;
  monitor: SeriesMonitor;
  seriesType: SeriesTypeOption;
  searchForMissingEpisodes: boolean;
};

/** The admin's saved Sonarr defaults (see src/server/settings/add-defaults.ts). Ids and monitor may be null. */
export type SeriesAddDefaultOptions = { profileId: number | null; rootFolderId: number | null; monitor: SeriesMonitor | null };

/**
 * The saved profile and root folder when they are still in the lists, otherwise the first of each. The saved
 * monitor option, or "all" when none is saved. Series type "standard", search on. Lists come from the server
 * sorted. A null folder list (Sonarr's root folders could not be loaded) selects no folder.
 */
export function defaultSeriesOptions(
  profiles: readonly QualityProfileOption[],
  folders: readonly RootFolderOption[] | null,
  defaults?: SeriesAddDefaultOptions,
): SeriesAddOptions {
  const profile = profiles.find((option) => option.id === defaults?.profileId) ?? profiles[0];
  const folder = folders?.find((option) => option.id === defaults?.rootFolderId) ?? folders?.[0];
  return {
    profileId: profile?.id ?? null,
    rootFolderId: folder?.id ?? null,
    monitor: defaults?.monitor ?? "all",
    seriesType: "standard",
    searchForMissingEpisodes: true,
  };
}

/**
 * The addLibrarySeries payload for one result, or null when no profile or root folder is selected
 * (the dialog disables Add in that case, so this is a guard).
 */
export function buildSeriesAddRequest(tvdbId: number, options: SeriesAddOptions) {
  if (options.profileId === null || options.rootFolderId === null) return null;
  return {
    tvdbId,
    qualityProfileId: options.profileId,
    rootFolderId: options.rootFolderId,
    monitor: options.monitor,
    seriesType: options.seriesType,
    searchForMissingEpisodes: options.searchForMissingEpisodes,
  };
}

/** Whether a result shows "In library": Sonarr said so on the search, or it was added during this dialog. */
export function isSeriesInLibrary(result: Pick<SeriesLookupResult, "tvdbId" | "inLibrary">, addedIds: ReadonlySet<number>): boolean {
  return result.inLibrary || addedIds.has(result.tvdbId);
}

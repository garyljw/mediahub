import type { SeriesStatus } from "@/server/arr/series";
import type { EpisodeStatus } from "@/server/arr/series-detail";

// Status badges for TV. Shared by the TV table and the series detail page, so both label and colour a status the same way.
export const STATUS_LABEL: Record<SeriesStatus, string> = {
  continuing: "Continuing",
  ended: "Ended",
  upcoming: "Upcoming",
};

// Same colours as the Movies badges: continuing reads as downloaded, upcoming as missing, ended as unreleased.
export const STATUS_CLASS: Record<SeriesStatus, string> = {
  continuing: "border-transparent bg-emerald-600/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  ended: "border-transparent bg-muted text-muted-foreground",
  upcoming: "border-transparent bg-amber-500/20 text-amber-800 dark:text-amber-300",
};

// Episode badges on the series page use the same colours: downloaded reads as present, missing as needed,
// and the rest are muted.
export const EPISODE_STATUS_LABEL: Record<EpisodeStatus, string> = {
  downloaded: "Downloaded",
  missing: "Missing",
  unaired: "Not aired",
  unmonitored: "Unmonitored",
};

export const EPISODE_STATUS_CLASS: Record<EpisodeStatus, string> = {
  downloaded: "border-transparent bg-emerald-600/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  missing: "border-transparent bg-amber-500/20 text-amber-800 dark:text-amber-300",
  unaired: "border-transparent bg-muted text-muted-foreground",
  unmonitored: "border-transparent bg-muted text-muted-foreground",
};


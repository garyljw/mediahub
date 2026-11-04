import type { MovieStatus } from "@/server/arr/movies";

// Status badges for movies. Shared by the movie page and the merged library rows, so both label and colour a status the same way.
export const STATUS_LABEL: Record<MovieStatus, string> = {
  downloaded: "Downloaded",
  missing: "Missing",
  unreleased: "Unreleased",
};

export const STATUS_CLASS: Record<MovieStatus, string> = {
  downloaded: "border-transparent bg-emerald-600/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  missing: "border-transparent bg-amber-500/20 text-amber-800 dark:text-amber-300",
  unreleased: "border-transparent bg-muted text-muted-foreground",
};

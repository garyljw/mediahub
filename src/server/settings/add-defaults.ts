import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { setting } from "@/server/db/schema";
import { SERIES_MONITOR_OPTIONS, type SeriesMonitor } from "@/components/tv/series-add";

// The defaults that pre-fill the Add movie and Add series dialogs, set by an admin in Settings -> Add defaults.
// Stored as plain values in the setting table. Reading never throws: a missing or unparseable value is null.

export type MovieAddDefaults = { profileId: number | null; rootFolderId: number | null };
export type SeriesAddDefaults = { profileId: number | null; rootFolderId: number | null; monitor: SeriesMonitor | null };

const MOVIE_KEYS = ["radarr.defaultProfileId", "radarr.defaultRootFolderId"] as const;
const SERIES_KEYS = ["sonarr.defaultProfileId", "sonarr.defaultRootFolderId", "sonarr.defaultMonitor"] as const;

function readValues(keys: readonly string[]): Map<string, string> {
  const rows = db().select().from(setting).where(inArray(setting.key, [...keys])).all();
  return new Map(rows.map((row) => [row.key, row.value]));
}

/** A stored id, or null unless it is a positive integer written in plain digits. */
function parseId(raw: string | undefined): number | null {
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** A stored monitor option, or null when it is not one of SERIES_MONITOR_OPTIONS. */
function parseMonitor(raw: string | undefined): SeriesMonitor | null {
  return SERIES_MONITOR_OPTIONS.find((option) => option === raw) ?? null;
}

/** The Radarr defaults. Missing or unparseable values are null. */
export function getMovieAddDefaults(): MovieAddDefaults {
  const values = readValues(MOVIE_KEYS);
  return {
    profileId: parseId(values.get("radarr.defaultProfileId")),
    rootFolderId: parseId(values.get("radarr.defaultRootFolderId")),
  };
}

/** The Sonarr defaults. Missing or unparseable values are null. */
export function getSeriesAddDefaults(): SeriesAddDefaults {
  const values = readValues(SERIES_KEYS);
  return {
    profileId: parseId(values.get("sonarr.defaultProfileId")),
    rootFolderId: parseId(values.get("sonarr.defaultRootFolderId")),
    monitor: parseMonitor(values.get("sonarr.defaultMonitor")),
  };
}

/** Upserts each key/value pair in one transaction. */
function saveValues(pairs: readonly (readonly [string, string])[]): void {
  const updatedAt = new Date();
  db().transaction((tx) => {
    for (const [key, value] of pairs) {
      tx.insert(setting)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({ target: setting.key, set: { value, updatedAt } })
        .run();
    }
  });
}

/** Stores the Radarr defaults. The caller must have checked both ids against Radarr first. */
export function saveMovieAddDefaults(defaults: { profileId: number; rootFolderId: number }): void {
  saveValues([
    ["radarr.defaultProfileId", String(defaults.profileId)],
    ["radarr.defaultRootFolderId", String(defaults.rootFolderId)],
  ]);
}

/** Stores the Sonarr defaults. The caller must have checked both ids against Sonarr first. */
export function saveSeriesAddDefaults(defaults: { profileId: number; rootFolderId: number; monitor: SeriesMonitor }): void {
  saveValues([
    ["sonarr.defaultProfileId", String(defaults.profileId)],
    ["sonarr.defaultRootFolderId", String(defaults.rootFolderId)],
    ["sonarr.defaultMonitor", defaults.monitor],
  ]);
}

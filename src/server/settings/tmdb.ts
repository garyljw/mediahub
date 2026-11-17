import "server-only";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { setting } from "@/server/db/schema";
import { clearTmdbCache } from "@/server/tmdb/client";
import { POPULAR_INCLUDE_KEYS, type PopularInclude } from "@/components/settings/popular-includes";
import { DEFAULT_TMDB_LANGUAGE, TMDB_LANGUAGE_CODES, type TmdbLanguage } from "@/components/settings/tmdb-languages";

// The optional TMDB connection (Read Access Token + country) is stored in SQLite, set by an admin in
// Settings -> Connections. It powers the Popular page.

export const DEFAULT_TMDB_REGION = "GB";

export type TmdbConfig = { token: string; region: string; language: TmdbLanguage };

const TOKEN_KEY = "tmdb.token";
const REGION_KEY = "tmdb.region";
const LANGUAGE_KEY = "tmdb.language";
const SERVICES_KEY = "tmdb.services";
const INCLUDE_KEY = "tmdb.include";

function languageOf(value: string | undefined): TmdbLanguage {
  return TMDB_LANGUAGE_CODES.find((code) => code === value) ?? DEFAULT_TMDB_LANGUAGE;
}

function readValues(): Map<string, string> {
  const rows = db().select().from(setting).where(inArray(setting.key, [TOKEN_KEY, REGION_KEY, LANGUAGE_KEY])).all();
  return new Map(rows.map((row) => [row.key, row.value]));
}

/** The stored token and country, or null when no token is stored. */
export function getTmdbConfig(): TmdbConfig | null {
  const values = readValues();
  const token = values.get(TOKEN_KEY);
  if (!token) return null;
  return { token, region: values.get(REGION_KEY) || DEFAULT_TMDB_REGION, language: languageOf(values.get(LANGUAGE_KEY)) };
}

/** What the Settings page may show. Never includes the token, only whether one is stored. */
export function getTmdbSummary(): { hasToken: boolean; region: string; language: TmdbLanguage } {
  const values = readValues();
  return {
    hasToken: Boolean(values.get(TOKEN_KEY)),
    region: values.get(REGION_KEY) || DEFAULT_TMDB_REGION,
    language: languageOf(values.get(LANGUAGE_KEY)),
  };
}

/** Stores the values in one transaction, and drops the cached TMDB lists (they were fetched with the old token or country). The caller must have checked the token with TMDB first. */
export function saveTmdbConfig({ token, region, language }: TmdbConfig): void {
  const updatedAt = new Date();
  db().transaction((tx) => {
    for (const [key, value] of [
      [TOKEN_KEY, token],
      [REGION_KEY, region],
      [LANGUAGE_KEY, language],
    ] as const) {
      tx.insert(setting)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({ target: setting.key, set: { value, updatedAt } })
        .run();
    }
  });
  clearTmdbCache();
}

/** Removes the token, country, language, chosen services and included categories. */
export function removeTmdbConfig(): void {
  db().delete(setting).where(inArray(setting.key, [TOKEN_KEY, REGION_KEY, LANGUAGE_KEY, SERVICES_KEY, INCLUDE_KEY])).run();
  clearTmdbCache();
}

const ServicesSchema = z.array(z.number().int().positive());

/** The TMDB provider ids the admin chose for the Popular page, in display order. Empty when none, or when the stored value is unreadable. */
export function getChosenServices(): number[] {
  const row = db().select().from(setting).where(eq(setting.key, SERVICES_KEY)).get();
  if (!row) return [];
  try {
    const parsed = ServicesSchema.safeParse(JSON.parse(row.value));
    // Duplicates are dropped (first wins), so a hand-edited value can't show a service twice.
    return parsed.success ? [...new Set(parsed.data)] : [];
  } catch {
    return [];
  }
}

/** Stores the chosen provider ids in display order. The caller checks them against TMDB first. */
export function saveChosenServices(ids: readonly number[]): void {
  const value = JSON.stringify(ids);
  const updatedAt = new Date();
  db()
    .insert(setting)
    .values({ key: SERVICES_KEY, value, updatedAt })
    .onConflictDoUpdate({ target: setting.key, set: { value, updatedAt } })
    .run();
}

const IncludeSchema = z.array(z.string());

/** The Popular categories the admin chose to include, in canonical order. Unknown keys and duplicates are dropped. Empty when none, or when the stored value is unreadable. */
export function getPopularIncludes(): PopularInclude[] {
  const row = db().select().from(setting).where(eq(setting.key, INCLUDE_KEY)).get();
  if (!row) return [];
  try {
    const parsed = IncludeSchema.safeParse(JSON.parse(row.value));
    if (!parsed.success) return [];
    return POPULAR_INCLUDE_KEYS.filter((key) => parsed.data.includes(key));
  } catch {
    return [];
  }
}

/** Stores the included categories. The caller has validated the keys. */
export function savePopularIncludes(keys: readonly PopularInclude[]): void {
  const value = JSON.stringify(POPULAR_INCLUDE_KEYS.filter((key) => keys.includes(key)));
  const updatedAt = new Date();
  db()
    .insert(setting)
    .values({ key: INCLUDE_KEY, value, updatedAt })
    .onConflictDoUpdate({ target: setting.key, set: { value, updatedAt } })
    .run();
}

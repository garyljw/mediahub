import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { setting } from "@/server/db/schema";

// Radarr and Sonarr connections (URL + API key) are stored in SQLite, set by an admin in
// Settings -> Connections. This is the only source for them: env() does not hold them.

export type ArrApp = "radarr" | "sonarr";

export type Connection = { url: string; apiKey: string };

const urlKey = (app: ArrApp) => `${app}.url`;
const apiKeyKey = (app: ArrApp) => `${app}.apiKey`;

function readValues(app: ArrApp): Map<string, string> {
  const rows = db()
    .select()
    .from(setting)
    .where(inArray(setting.key, [urlKey(app), apiKeyKey(app)]))
    .all();
  return new Map(rows.map((row) => [row.key, row.value]));
}

/** The connection for an app, or null unless both the URL and the key are stored. */
export function getConnection(app: ArrApp): Connection | null {
  const values = readValues(app);
  const url = values.get(urlKey(app));
  const apiKey = values.get(apiKeyKey(app));
  if (!url || !apiKey) return null;
  return { url, apiKey };
}

/**
 * What the Settings page may show. Never includes the key, only whether one is stored.
 * Stored API keys are write-only: they never go to the browser.
 */
export function getConnectionSummary(app: ArrApp): { url: string | null; hasKey: boolean } {
  const values = readValues(app);
  return { url: values.get(urlKey(app)) ?? null, hasKey: Boolean(values.get(apiKeyKey(app))) };
}

/** Stores both values for an app in one transaction. The caller must have checked the connection first. */
export function saveConnection(app: ArrApp, { url, apiKey }: Connection): void {
  const updatedAt = new Date();
  db().transaction((tx) => {
    for (const [key, value] of [
      [urlKey(app), url],
      [apiKeyKey(app), apiKey],
    ] as const) {
      tx.insert(setting)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({ target: setting.key, set: { value, updatedAt } })
        .run();
    }
  });
}

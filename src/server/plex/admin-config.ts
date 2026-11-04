import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { setting } from "@/server/db/schema";
import { clearPlexDataConnection } from "./data-connection";

// Which Plex server and account MediaHub's admin must come from. Set once by the first successful
// /setup. Only the Plex account that owns this server, and matches the owner account id, can be admin.

const SERVER_ID_KEY = "plex.serverId";
const SERVER_NAME_KEY = "plex.serverName";
const OWNER_KEY = "plex.ownerAccountId";
const ALL_KEYS = [SERVER_ID_KEY, SERVER_NAME_KEY, OWNER_KEY];

export type PlexAdminConfig = { serverId: string; serverName: string; ownerAccountId: string };

/** The stored admin configuration, or null until setup has finished (all three values must be present). */
export function getPlexAdminConfig(): PlexAdminConfig | null {
  const values = new Map(
    db()
      .select()
      .from(setting)
      .where(inArray(setting.key, ALL_KEYS))
      .all()
      .map((row) => [row.key, row.value]),
  );
  const serverId = values.get(SERVER_ID_KEY);
  const serverName = values.get(SERVER_NAME_KEY);
  const ownerAccountId = values.get(OWNER_KEY);
  if (!serverId || !serverName || !ownerAccountId) return null;
  return { serverId, serverName, ownerAccountId };
}

/**
 * Stores the admin configuration. This is the race guard: the serverId row is inserted with
 * onConflictDoNothing, and only the call whose insert actually happened returns true. A second
 * setup that races this one gets false and stores nothing.
 */
export function claimPlexAdminConfig(config: PlexAdminConfig): boolean {
  const updatedAt = new Date();
  return db().transaction((tx) => {
    const claimed = tx
      .insert(setting)
      .values({ key: SERVER_ID_KEY, value: config.serverId, updatedAt })
      .onConflictDoNothing()
      .run();
    if (claimed.changes === 0) return false;

    for (const [key, value] of [
      [SERVER_NAME_KEY, config.serverName],
      [OWNER_KEY, config.ownerAccountId],
    ] as const) {
      tx.insert(setting)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({ target: setting.key, set: { value, updatedAt } })
        .run();
    }
    return true;
  });
}

/**
 * Break-glass only: removes the admin configuration so setup can run again (see scripts/reset-plex-admin.ts).
 * The Plex data connection is cleared too: its token may belong to the account that was just removed.
 */
export function clearPlexAdminConfig(): void {
  db().delete(setting).where(inArray(setting.key, ALL_KEYS)).run();
  clearPlexDataConnection();
}

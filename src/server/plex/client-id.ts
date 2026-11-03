import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { setting } from "@/server/db/schema";

// The Plex client id MediaHub signs in with. It is one fixed identifier for this install, not a
// secret: it is stored in the setting table on first use and reused for every sign-in, so Plex shows
// one device entry no matter how many times someone signs in.

const SETTING_KEY = "plex.signInClientId";

let cached: string | undefined;

function storedClientId(): string | undefined {
  return db().select().from(setting).where(eq(setting.key, SETTING_KEY)).get()?.value;
}

/** The client id every plex.tv request is made as. Generated once, then read from the setting table. */
export function getPlexClientId(): string {
  if (cached) return cached;

  const existing = storedClientId();
  if (existing) {
    cached = existing;
    return existing;
  }

  // onConflictDoNothing: if another request stored one first, its value wins and is read back below.
  db()
    .insert(setting)
    .values({ key: SETTING_KEY, value: `mediahub-${randomUUID()}`, updatedAt: new Date() })
    .onConflictDoNothing()
    .run();

  const stored = storedClientId();
  if (!stored) throw new Error("The Plex client id could not be stored or read back.");
  cached = stored;
  return stored;
}

/** Forgets the in-memory copy so the next call reads the setting table again. For tests only. */
export function resetPlexClientIdCache(): void {
  cached = undefined;
}

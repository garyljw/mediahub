import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { setting } from "@/server/db/schema";
import { env } from "@/server/env";

// The session signing secret. BETTER_AUTH_SECRET in the environment wins when set. Otherwise
// one is generated on first use and stored in the setting table, so the app works without it.

const SETTING_KEY = "auth.secret";

function storedSecret(): string | undefined {
  return db().select().from(setting).where(eq(setting.key, SETTING_KEY)).get()?.value;
}

/** The secret Better Auth signs sessions with. Changing it signs everyone out. */
export function getAuthSecret(): string {
  const fromEnv = env().BETTER_AUTH_SECRET;
  if (fromEnv) return fromEnv;

  const existing = storedSecret();
  if (existing) return existing;

  // onConflictDoNothing: if another process stored one first, its value wins and is read back below.
  db()
    .insert(setting)
    .values({ key: SETTING_KEY, value: randomBytes(32).toString("base64url"), updatedAt: new Date() })
    .onConflictDoNothing()
    .run();

  const stored = storedSecret();
  if (!stored) throw new Error("The auth secret could not be stored or read back.");
  return stored;
}

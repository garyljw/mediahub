import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { setting } from "@/server/db/schema";

// The Settings switch "Auto-import downloads matched by ID". Off by default. Stored as "true" or "false" in the setting
// table. Reading never throws: a missing or unreadable value counts as off.

const KEY = "autoImport.matchedById";

/** True only when the switch is on. A missing or unreadable value is off. */
export function readAutoImportMatchedById(): boolean {
  try {
    const row = db().select().from(setting).where(eq(setting.key, KEY)).get();
    return row?.value === "true";
  } catch {
    return false;
  }
}

/** Stores the switch. */
export function saveAutoImportMatchedById(on: boolean): void {
  const value = on ? "true" : "false";
  const updatedAt = new Date();
  db()
    .insert(setting)
    .values({ key: KEY, value, updatedAt })
    .onConflictDoUpdate({ target: setting.key, set: { value, updatedAt } })
    .run();
}

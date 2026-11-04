import "server-only";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDbForMigration } from "./index";

/**
 * Applies pending migrations from migrationsFolder to the database at DATABASE_PATH.
 * Shared by scripts/migrate.ts (repo root, "drizzle") and the packaged launcher and tools,
 * which pass a path relative to their own file. Throws on failure; callers print the message.
 */
export function applyMigrations(migrationsFolder: string): void {
  migrate(openDbForMigration(), { migrationsFolder });
}

// Applies pending migrations from drizzle/ to the database at DATABASE_PATH.
//
// Usage: npm run db:migrate
//
// Goes through applyMigrations() in src/server/db/migrate.ts, which uses
// openDbForMigration() from src/server/db. That creates the data directory and sets
// file permissions, and skips the up-to-date check that db() does, since this script
// is what applies the migrations. drizzle-kit migrate is not used because it does not
// create missing directories.
//
// Run with --conditions=react-server (set in package.json) so the server-only
// import in src/server resolves to an empty module outside Next.js.

import { applyMigrations } from "../src/server/db/migrate";

try {
  // Paths are relative to the repo root, which npm scripts run from.
  applyMigrations("drizzle");
  console.log("Migrations applied.");
} catch (error) {
  // Print only the message. Config errors list variable names, never values.
  console.error(`db:migrate: ${error instanceof Error ? error.message : "unexpected error."}`);
  process.exitCode = 1;
}

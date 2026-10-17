// Applies pending migrations from drizzle/ to the database at DATABASE_PATH.
//
// Usage: npm run db:migrate
//
// Goes through db() from src/server/db, which creates the data directory and
// sets file permissions. drizzle-kit migrate is not used because it does not
// create missing directories.
//
// Run with --conditions=react-server (set in package.json) so the server-only
// import in src/server resolves to an empty module outside Next.js.

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "../src/server/db";

try {
  // Paths are relative to the repo root, which npm scripts run from.
  migrate(db(), { migrationsFolder: "drizzle" });
  console.log("Migrations applied.");
} catch (error) {
  // Print only the message. Config errors list variable names, never values.
  console.error(`db:migrate: ${error instanceof Error ? error.message : "unexpected error."}`);
  process.exitCode = 1;
}

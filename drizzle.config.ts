import { defineConfig } from "drizzle-kit";

// Only used by `drizzle-kit generate`, which reads the schema and writes SQL
// without opening a database. Applying migrations is done by scripts/migrate.ts,
// which goes through src/server/db so it uses the same DATABASE_PATH as the app.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
});

import "server-only";
import path from "node:path";
import { z } from "zod";

/** True when Intl accepts the zone name, e.g. "Europe/London". Node and the browser both know the IANA zones. */
function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const schema = z.object({
  // Optional. When unset, MediaHub generates one and stores it (see settings/auth-secret.ts).
  // An empty value counts as unset, so a copied-but-blank line in .env.local doesn't stop startup.
  BETTER_AUTH_SECRET: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(32).optional()),
  BETTER_AUTH_URL: z.url(),
  DATABASE_PATH: z.string().min(1).default("./data/mediahub.db"),
  // Where the packaged app (dist/mediahub/mediahub.mjs) listens. `npm run dev` ignores these and uses 3000.
  // MediaHub's own names, because the generic HOSTNAME is often already set to the machine or container name.
  // Blank counts as unset, like BETTER_AUTH_SECRET, so an empty line never breaks every env() caller.
  MEDIAHUB_HOST: z.preprocess((value) => (value === "" ? undefined : value), z.string().default("0.0.0.0")),
  MEDIAHUB_PORT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1).max(65535).default(7979),
  ),
  // Overnight updates (03:00 to 04:00, PC time). Blank means the default, on. Only true or false (any case) is accepted.
  MEDIAHUB_AUTO_UPDATE: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() || undefined : value),
    z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  ),
  // The updater's folder (C:\ProgramData\MediaHub\updates), set by the Windows service config. Unset elsewhere.
  MEDIAHUB_UPDATES_DIR: z.preprocess((value) => (value === "" ? undefined : value), z.string().optional()),
  // Keeps the Plex collections for Movie Focus and TV Focus in step with MediaHub. Blank means true. Only true or false
  // (any case) is accepted. A copy that shares a Plex server with another (such as a development copy) sets it to false,
  // so it never creates or changes those collections.
  MEDIAHUB_PLEX_FOCUS_SYNC: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() || undefined : value),
    z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  ),
  // Names this copy's Plex collections, e.g. "dev" gives "Movie Focus (dev)" and "TV Focus (dev)", which aren't pinned to
  // Home. For a second copy that shares a Plex server, so its collections don't clash with the real ones. Blank is unset.
  MEDIAHUB_PLEX_FOCUS_TEST_NAME: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() || undefined : value),
    z
      .string()
      .min(1)
      .max(20)
      .regex(/^[A-Za-z0-9 _-]+$/, "must be 1 to 20 letters, digits, spaces, - or _")
      .optional(),
  ),
  DISPLAY_TIMEZONE: z
    .string()
    .default("Europe/London")
    .refine(isValidTimeZone, "must be an IANA time zone, e.g. Europe/London"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server-side environment. Throws with a readable list of problems. */
export function env(): Env {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  cached = result.data;
  return cached;
}

/**
 * A copy of this process's environment, to pass on to a child process. It is not configuration: read config with env().
 */
export function processEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env };
}

/**
 * The Windows folder, for running the System32 tools by full path. Not configuration, but this file is the one
 * place allowed to read process.env.
 */
export function systemRoot(): string {
  return process.env.SystemRoot || "C:\\Windows";
}

/**
 * For the packaged launcher only, called before migrations and before server.js loads.
 * - The Next standalone server reads HOSTNAME and PORT when it loads, so MEDIAHUB_HOST and MEDIAHUB_PORT are
 *   copied onto them, overriding whatever the host already set.
 * - server.js changes the working directory to its own folder, so a relative DATABASE_PATH would point the
 *   server at a different file than the one the launcher just migrated. It is made absolute here, against the
 *   directory the launcher was started from.
 */
export function preparePackagedRuntime(): void {
  const { MEDIAHUB_HOST, MEDIAHUB_PORT, DATABASE_PATH } = env();
  process.env.HOSTNAME = MEDIAHUB_HOST;
  process.env.PORT = String(MEDIAHUB_PORT);
  process.env.DATABASE_PATH = path.resolve(DATABASE_PATH);
}

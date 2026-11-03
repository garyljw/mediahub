import "server-only";
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
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  DATABASE_PATH: z.string().min(1).default("./data/mediahub.db"),
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

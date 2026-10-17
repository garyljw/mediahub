import "server-only";
import { z } from "zod";

const schema = z.object({
  RADARR_URL: z.url(),
  RADARR_API_KEY: z.string().min(20),
  SONARR_URL: z.url(),
  SONARR_API_KEY: z.string().min(20),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  DATABASE_PATH: z.string().min(1).default("./data/mediahub.db"),
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

import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// THIRD_PARTY_NOTICES.json and .txt are written by scripts/package.mjs into the package folder, next to build-info.json.
// Like app-version.ts, the server reads them from process.cwd(), which is that folder in the package. In development
// (and tests) they are missing, and the callers show that. Nothing is cached: the reads are small and rare.

const SummarySchema = z.array(
  z.object({
    name: z.string(),
    version: z.string(),
    licence: z.string(),
  }),
);

export type NoticeSummary = z.infer<typeof SummarySchema>[number];

/** The package list for the About page (name, version, licence), or null when the file is missing or invalid. */
export function noticesSummary(): NoticeSummary[] | null {
  try {
    // turbopackIgnore stops Next's file tracing from treating this as a file the build needs.
    const raw: unknown = JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "THIRD_PARTY_NOTICES.json"), "utf8"));
    const parsed = SummarySchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The full licence texts (THIRD_PARTY_NOTICES.txt), or null when the file is missing. */
export function noticesText(): string | null {
  try {
    return readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "THIRD_PARTY_NOTICES.txt"), "utf8");
  } catch {
    return null;
  }
}

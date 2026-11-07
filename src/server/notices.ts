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

/** True for "the file isn't there", the normal case in development. Anything else is worth a log line. */
function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** The package list for the About page (name, version, licence), or null when the file is missing or invalid. */
export function noticesSummary(): NoticeSummary[] | null {
  let raw: unknown;
  try {
    // turbopackIgnore stops Next's file tracing from treating this as a file the build needs.
    raw = JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "THIRD_PARTY_NOTICES.json"), "utf8"));
  } catch (error) {
    if (!isMissing(error)) console.error("About page: THIRD_PARTY_NOTICES.json could not be read");
    return null;
  }
  const parsed = SummarySchema.safeParse(raw);
  if (!parsed.success) console.error("About page: THIRD_PARTY_NOTICES.json is not a valid licence list");
  return parsed.success ? parsed.data : null;
}

/** The full licence texts (THIRD_PARTY_NOTICES.txt), or null when the file is missing. */
export function noticesText(): string | null {
  try {
    return readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "THIRD_PARTY_NOTICES.txt"), "utf8");
  } catch (error) {
    if (!isMissing(error)) console.error("About page: THIRD_PARTY_NOTICES.txt could not be read");
    return null;
  }
}

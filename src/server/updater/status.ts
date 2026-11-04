import "server-only";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";

const isoTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "not a time");

export const statusSchema = z.object({
  installedVersion: z.string(),
  latestVersion: z.string().nullable(),
  lastCheckAt: isoTime.nullable(),
  lastNightlyDate: z.string().nullable(),
  state: z.enum(["idle", "checking", "installing"]),
  skipped: z.array(z.string()),
  lastResult: z
    .object({
      kind: z.enum(["up-to-date", "installed", "rolled-back", "failed", "check-failed"]),
      version: z.string().nullable(),
      at: isoTime,
      message: z.string(),
    })
    .nullable(),
});

export type Status = z.infer<typeof statusSchema>;
export type LastResult = NonNullable<Status["lastResult"]>;

export function defaultStatus(installedVersion: string): Status {
  return {
    installedVersion,
    latestVersion: null,
    lastCheckAt: null,
    lastNightlyDate: null,
    state: "idle",
    skipped: [],
    lastResult: null,
  };
}

/**
 * Reads the status file. A missing, unreadable or invalid file gives the defaults for `installedVersion`.
 * The caller refreshes installedVersion from the app folder, so the stored value is not trusted over it.
 */
export function readStatus(file: string, installedVersion: string): Status {
  try {
    const parsed = statusSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    // Fall through to the defaults.
  }
  return defaultStatus(installedVersion);
}

/** Writes the status file through a temp file and a rename, so readers never see a half-written file. */
export function writeStatus(file: string, status: Status): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  renameSync(temp, file);
}

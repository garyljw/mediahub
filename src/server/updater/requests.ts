import "server-only";
import { lstatSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import path from "node:path";

/** True when the requests folder has any entry. Reads only the folder listing. */
export function hasRequests(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * True when at least one entry was removed from the requests folder. Each entry is removed without being read
 * or followed: files, symlinks and junctions are unlinked, empty folders are removed. An entry that can't be
 * removed (a non-empty folder, a file held open) is logged and does not count, so it can't trigger a check
 * every minute.
 */
export function takeRequests(dir: string, log: (message: string) => void = () => {}): boolean {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  let removed = 0;
  for (const name of names) {
    const entry = path.join(dir, name);
    try {
      const stat = lstatSync(entry);
      if (stat.isDirectory()) {
        rmdirSync(entry);
      } else {
        try {
          unlinkSync(entry);
        } catch (error) {
          // Windows refuses to unlink some directory links (junctions); those are removed as directories.
          if (!isCode(error, "EPERM") && !isCode(error, "EISDIR")) throw error;
          rmdirSync(entry);
        }
      }
      removed += 1;
    } catch (error) {
      log(`Could not remove a request entry (${errorCode(error)}).`);
    }
  }
  return removed > 0;
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "unknown";
}

function isCode(error: unknown, code: string): boolean {
  return errorCode(error) === code;
}

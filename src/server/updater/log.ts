import "server-only";
import { appendFileSync, renameSync, statSync } from "node:fs";

const MAX_LOG_BYTES = 1024 * 1024;

/**
 * Returns a function that appends one timestamped line to `file`. When the file passes 1 MB it is
 * renamed to `<file>.1` (replacing the old copy) and a new file starts. Logging never throws.
 */
export function createLogger(file: string, now: () => Date = () => new Date()): (message: string) => void {
  return (message: string) => {
    try {
      try {
        if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.1`);
      } catch {
        // No log file yet, or it could not be rotated. Appending below creates or keeps it.
      }
      appendFileSync(file, `${now().toISOString()} ${message}\n`, "utf8");
    } catch {
      // A broken log must not stop an update.
    }
  };
}

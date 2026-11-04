import "server-only";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { APP_VERSION } from "@/server/app-version";
import { env } from "@/server/env";
import { formatLocalDateTime } from "@/server/merge/local-time";
import { hasRequests } from "@/server/updater/requests";
import { readStatus, type LastResult, type Status } from "@/server/updater/status";
import { compareVersions, isValidVersion } from "@/server/updater/version";

/** The only fields that reach the browser. Paths and the raw status file never leave the server. */
export type AvailableUpdates = {
  available: true;
  runningVersion: string;
  latestVersion: string | null;
  lastChecked: string | null;
  state: Status["state"];
  lastResult: { kind: LastResult["kind"]; message: string; at: string } | null;
  skipped: string[];
  checkQueued: boolean;
};

export type UpdatesView = { available: false; runningVersion: string } | AvailableUpdates;

/**
 * Builds the browser view from a status and the queue state. Pure: no file access, so it can be tested directly.
 * latestVersion is shown only when it is a valid version newer than the running one.
 */
export function toUpdatesView(
  status: Status,
  runningVersion: string,
  checkQueued: boolean,
  timeZone: string,
): AvailableUpdates {
  const latest = status.latestVersion;
  const newer =
    latest !== null &&
    isValidVersion(latest) &&
    isValidVersion(runningVersion) &&
    compareVersions(latest, runningVersion) > 0;

  return {
    available: true,
    runningVersion,
    latestVersion: newer ? latest : null,
    lastChecked: status.lastCheckAt ? formatLocalDateTime(status.lastCheckAt, timeZone) : null,
    state: status.state,
    lastResult: status.lastResult
      ? {
          kind: status.lastResult.kind,
          message: status.lastResult.message,
          at: formatLocalDateTime(status.lastResult.at, timeZone),
        }
      : null,
    skipped: status.skipped.filter(isValidVersion),
    checkQueued,
  };
}

/** What the Settings → Updates page shows. Unavailable unless MEDIAHUB_UPDATES_DIR is set (the Windows service). */
export function getUpdatesView(): UpdatesView {
  const config = env();
  const dir = config.MEDIAHUB_UPDATES_DIR;
  if (!dir) return { available: false, runningVersion: APP_VERSION };

  const status = readStatus(path.join(dir, "status.json"), APP_VERSION);
  const queued = hasRequests(path.join(dir, "requests"));
  return toUpdatesView(status, APP_VERSION, queued, config.DISPLAY_TIMEZONE);
}

/**
 * Asks the updater to check now by creating an empty entry in the requests folder. The entry's name is random and
 * its contents are never read. Fs errors are thrown for the caller to handle.
 */
export function requestUpdateCheck(): "queued" | "already-queued" | "unavailable" {
  const dir = env().MEDIAHUB_UPDATES_DIR;
  if (!dir) return "unavailable";

  const requests = path.join(dir, "requests");
  if (hasRequests(requests)) return "already-queued";
  writeFileSync(path.join(requests, `check-${randomUUID()}`), "", { flag: "wx" });
  return "queued";
}

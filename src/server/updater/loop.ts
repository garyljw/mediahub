import "server-only";
import { parseEnv } from "node:util";
import { localDate } from "./schedule";

/** The local hour in which the nightly check happens. Stage 1 still decides once a night (see schedule.ts). */
export const NIGHTLY_HOUR = 3;

/**
 * True when the launcher should start stage 1 now. Never while one is still running. Otherwise: the first run after
 * the service starts (so stage 1 can recover an interrupted update), a "check now" request, or the nightly hour once
 * per night (`nightlyRanOn` is the local date the launcher last started it in that hour). Stage 1 still makes the
 * final decision (see schedule.ts).
 */
export function shouldRunStage1(input: {
  now: Date;
  hasRequest: boolean;
  running: boolean;
  startup: boolean;
  nightlyRanOn: string | null;
}): boolean {
  if (input.running) return false;
  if (input.startup || input.hasRequest) return true;
  return input.now.getHours() === NIGHTLY_HOUR && input.nightlyRanOn !== localDate(input.now);
}

/**
 * A copy of the parent's environment without any variable the env file sets. The child gets the env file through
 * --env-file, and Node keeps inherited variables over the file's, so without this an edit to the file would not
 * apply until the service restarts. Names are compared without case, as Windows does.
 */
export function childEnv(parentEnv: NodeJS.Dict<string>, envFileText: string): NodeJS.Dict<string> {
  const fileNames = new Set(Object.keys(parseEnv(envFileText)).map((name) => name.toUpperCase()));
  const result: NodeJS.Dict<string> = {};
  for (const [name, value] of Object.entries(parentEnv)) {
    if (!fileNames.has(name.toUpperCase())) result[name] = value;
  }
  return result;
}

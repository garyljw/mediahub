import "server-only";

export interface DecideInput {
  now: Date;
  lastNightlyDate: string | null;
  autoUpdate: boolean;
  hasRequest: boolean;
  /** ISO time of the last check of any kind, or null. */
  lastCheckAt: string | null;
}

/** "Check now" requests closer together than this are dropped, so requests can't make a check every minute. */
export const MANUAL_MIN_GAP_MS = 2 * 60 * 1000;
/** A failed nightly check is retried within the 03:xx hour, but not more often than this. */
export const NIGHTLY_RETRY_GAP_MS = 10 * 60 * 1000;

export interface Decision {
  check: boolean;
  manual: boolean;
  /** Local date to record as the nightly check's date, or null when this run is not a nightly check. */
  nightlyDate: string | null;
}

/** The local calendar date as YYYY-MM-DD (the PC's time zone, not UTC). */
export function localDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Whether to check for an update this minute. A request (a manual "check now") checks, unless the last check
 * was less than MANUAL_MIN_GAP_MS ago. Otherwise the nightly check runs during the 03:xx local hour when
 * auto-update is on, at most every NIGHTLY_RETRY_GAP_MS, until the release list has been read that night
 * (checkRelease records the date then).
 */
export function decide(input: DecideInput): Decision {
  const sinceLast = input.lastCheckAt === null ? Infinity : input.now.getTime() - Date.parse(input.lastCheckAt);
  // An unparseable time counts as long ago.
  const gap = Number.isNaN(sinceLast) ? Infinity : sinceLast;
  if (input.hasRequest) {
    if (gap >= MANUAL_MIN_GAP_MS) return { check: true, manual: true, nightlyDate: null };
  }
  const date = localDate(input.now);
  if (input.autoUpdate && input.now.getHours() === 3 && date !== input.lastNightlyDate && gap >= NIGHTLY_RETRY_GAP_MS) {
    return { check: true, manual: false, nightlyDate: date };
  }
  return { check: false, manual: false, nightlyDate: null };
}

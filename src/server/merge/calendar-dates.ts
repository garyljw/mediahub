import "server-only";
import { z } from "zod";

// Calendar dates are "YYYY-MM-DD" strings, handled in UTC so the server and the tests agree on every day.
// Nothing here uses Intl or the local timezone.

/** Days in one calendar view: five Monday-to-Sunday weeks. */
export const CALENDAR_DAYS = 35;
/** How far the Earlier and Later links move: four weeks. */
export const CALENDAR_STEP_DAYS = 28;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** True when the string is a real calendar date in the form "YYYY-MM-DD" (so 2026-02-30 is not). */
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Day of the week, 0 for Monday through 6 for Sunday. The input must already be a calendar date. */
function weekdayIndex(ymd: string): number {
  const day = new Date(Date.parse(`${ymd}T00:00:00Z`)).getUTCDay();
  return (day + 6) % 7;
}

/** Adds whole days to a calendar date. Negative values go back. */
export function addDays(ymd: string, days: number): string {
  const time = Date.parse(`${ymd}T00:00:00Z`) + days * MS_PER_DAY;
  return new Date(time).toISOString().slice(0, 10);
}

/** The Monday on or before the given calendar date. */
export function mondayOf(ymd: string): string {
  return addDays(ymd, -weekdayIndex(ymd));
}

/** The calendar date (in UTC) for a point in time, as "YYYY-MM-DD". */
export function utcDateOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** The default first day: the Monday of the week before the current one. */
export function defaultFrom(today: string): string {
  return addDays(mondayOf(today), -7);
}

/** Every day in the view, in order, starting at `from`. */
export function daysFrom(from: string): string[] {
  return Array.from({ length: CALENDAR_DAYS }, (_, index) => addDays(from, index));
}

/** The last day in the view, a Sunday. */
export function lastDayOf(from: string): string {
  return addDays(from, CALENDAR_DAYS - 1);
}

/** The strict form of the `from` URL parameter: a real Monday between 2000 and 2100. */
const fromSchema = z
  .string()
  .refine(isCalendarDate, "not a calendar date")
  .refine((ymd) => ymd >= "2000-01-01" && ymd <= "2100-12-31", "year out of range")
  .refine((ymd) => weekdayIndex(ymd) === 0, "not a Monday");

/**
 * The first day to show, from the `from` URL parameter. Anything invalid (missing, repeated, malformed, not a
 * Monday, out of range) falls back to the default, with no error.
 */
export function resolveFrom(param: unknown, today: string): string {
  const parsed = fromSchema.safeParse(param);
  return parsed.success ? parsed.data : defaultFrom(today);
}

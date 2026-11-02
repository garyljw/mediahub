import "server-only";

/** One formatter per zone. Building a DateTimeFormat costs far more than using one, and a page formats hundreds. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2 Nov 2026, 14:05" for an ISO date-time, shown in `timeZone` (an IANA name such as "Europe/London"). An em dash
 * when the time or the zone is invalid.
 *
 * This runs only on the server, and the result reaches the client as a prop string, so the browser never
 * re-formats it and no hydration mismatch is possible. Only the numeric parts come from Intl. The month name comes
 * from the fixed array, so no ICU month or day names are used.
 */
export function formatLocalDateTime(iso: string, timeZone: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "—";

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(timeZone).formatToParts(new Date(time));
  } catch {
    // An unknown zone name throws a RangeError. Env validation should stop that first, so this is a fallback.
    return "—";
  }

  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const day = part("day");
  const month = part("month");
  const year = part("year");
  const hour = part("hour");
  const minute = part("minute");
  if ([day, month, year, hour, minute].some((value) => !Number.isFinite(value)) || month < 1 || month > 12) return "—";

  return `${day} ${MONTHS[month - 1]} ${year}, ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

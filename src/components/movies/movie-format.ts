// Display formatting for the Movies table. Pure, so it can be tested without a DOM.

// These run during the server render and again in the browser, and the two must produce identical
// text. Intl output depends on each runtime's ICU data (Node said "Sept", Safari said "Sep"), so dates
// and counts are formatted by hand. UTC so both sides agree near midnight.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Mar 2024" for an ISO date-time (in UTC), or an em dash when missing or unparseable. */
export function formatAdded(iso: string | null): string {
  if (iso === null) return "—";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "—";
  const date = new Date(time);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "1,234": thousands separated by commas, without Intl, for the same reason as dates. */
export function formatCount(count: number): string {
  return String(Math.trunc(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Human-readable size in binary units, e.g. "12.3 GB". An em dash for zero or invalid sizes. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  let value = bytes;
  let unit = 0;
  // Compare the rounded value, so 1023.96 MB rolls over to "1.0 GB" instead of showing "1024 MB".
  while (Math.round(value) >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 100, none from 100 up. Decided on the rounded value, so 99.96 shows "100 MB".
  const digits = unit === 0 || Number(value.toFixed(1)) >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

import Link from "next/link";
import { cookies } from "next/headers";
import { z } from "zod";
import { requirePageUser } from "@/server/authz";
import { fetchEpisodeCalendar, fetchMovieCalendar } from "@/server/arr/calendar";
import { settledOrNull } from "@/server/arr/request";
import { toCalendarEntries, type CalendarEntry } from "@/server/merge/calendar";
import { CALENDAR_STEP_DAYS, addDays, daysFrom, lastDayOf, resolveFrom, utcDateOf } from "@/server/merge/calendar-dates";
import { CalendarView } from "@/components/calendar/calendar-view";
import {
  CALENDAR_VIEW_COOKIE,
  CALENDAR_VIEWS,
  type CalendarDay,
  type CalendarView as View,
} from "@/components/calendar/calendar-filters";
import { Button } from "@/components/ui/button";
import { formatDay, formatGridDay, formatRange } from "@/components/library/format";

export const metadata = { title: "Calendar" };
// Blocking route: the page waits for Radarr and Sonarr before rendering, so no Suspense fallback is needed.
export const instant = false;

const VIEW_SCHEMA = z.enum(CALENDAR_VIEWS);

/** The range, both calendars for it, and the day labels. Failures become alert text, so the rest still renders. */
async function loadCalendar(fromParam: unknown): Promise<{
  from: string;
  to: string;
  days: CalendarDay[];
  entries: CalendarEntry[];
  alerts: string[];
}> {
  const now = Date.now();
  const today = utcDateOf(now);
  const from = resolveFrom(fromParam, today);
  const to = lastDayOf(from);

  const [movieResult, episodeResult] = await Promise.allSettled([
    fetchMovieCalendar(from, to),
    fetchEpisodeCalendar(from, to),
  ]);
  const movies = settledOrNull(movieResult, "Calendar page");
  const episodes = settledOrNull(episodeResult, "Calendar page");

  const alerts: string[] = [];
  if (movies === null && episodes === null) {
    alerts.push("Couldn't load the calendar from Radarr or Sonarr.");
  } else {
    if (movies === null) alerts.push("Couldn't load movies from Radarr.");
    if (episodes === null) alerts.push("Couldn't load episodes from Sonarr.");
  }

  const days: CalendarDay[] = daysFrom(from).map((date, index) => ({
    date,
    label: formatDay(date),
    // The first cell and each 1st of a month name the month, so the grid shows where a month starts.
    gridLabel: formatGridDay(date, index === 0 || date.endsWith("-01")),
    isToday: date === today,
  }));
  return {
    from,
    to,
    days,
    entries: toCalendarEntries(movies ?? [], episodes ?? [], from, to, now),
    alerts,
  };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] | undefined }>;
}) {
  await requirePageUser("admin", "requester");

  const { from: fromParam } = await searchParams;
  const cookieStore = await cookies();
  const savedView = VIEW_SCHEMA.safeParse(cookieStore.get(CALENDAR_VIEW_COOKIE)?.value);
  const initialView: View = savedView.success ? savedView.data : "list";

  const { from, to, days, entries, alerts } = await loadCalendar(fromParam);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <nav aria-label="Calendar range" className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/calendar?from=${addDays(from, -CALENDAR_STEP_DAYS)}`}>← Earlier</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/calendar">Today</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/calendar?from=${addDays(from, CALENDAR_STEP_DAYS)}`}>Later →</Link>
          </Button>
        </nav>
      </div>

      <p className="text-sm text-muted-foreground">{formatRange(from, to)}</p>

      {alerts.map((message) => (
        <p key={message} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ))}

      <CalendarView days={days} entries={entries} initialView={initialView} />
    </div>
  );
}

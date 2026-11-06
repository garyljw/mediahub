"use client";

import Link from "next/link";
import { Film, Tv, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Poster } from "@/components/poster/poster";
import { usePosterPreview } from "@/components/poster/use-poster-preview";
import { SELECT_CLASS } from "@/components/library/table-parts";
import { cn } from "@/lib/utils";
import type { CalendarEntry, ReleaseType } from "@/server/merge/calendar";
import {
  CALENDAR_VIEW_COOKIE,
  DEFAULT_FILTERS,
  RELEASE_TYPES,
  entriesByDate,
  filterEntries,
  splitDayChips,
  type CalendarDay,
  type CalendarFilters,
  type CalendarView,
  type TypeFilter,
} from "./calendar-filters";
import { CALENDAR_STATUS_CHIP, CALENDAR_STATUS_CLASS, CALENDAR_STATUS_LABEL } from "./calendar-status";

const RELEASE_TYPE_LABEL: Record<ReleaseType, string> = {
  cinema: "Cinema",
  digital: "Digital",
  physical: "Physical",
};

const WEEKDAY_HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Weekend columns (Sat, Sun) are shaded in the grid. */
const WEEKEND_COLUMNS = [5, 6];

/** The text a grid chip shows: "Dune (Cinema)" for a movie, "Harbour Lights S02E05" for an episode. */
function chipTextOf(entry: CalendarEntry): string {
  return entry.kind === "movie" ? `${entry.title} (${entry.shortDetail})` : `${entry.title} ${entry.shortDetail}`;
}

/** One line in a grid cell. Movies have no page, so only episode chips with an href are links. */
function GridChip({ entry }: { entry: CalendarEntry }) {
  const Icon: LucideIcon = entry.kind === "movie" ? Film : Tv;
  const className = `flex min-w-0 items-center gap-1 rounded border px-1 py-0.5 text-xs ${CALENDAR_STATUS_CHIP[entry.status]}`;
  const content = (
    <>
      <span className="sr-only">{CALENDAR_STATUS_LABEL[entry.status]}: </span>
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{chipTextOf(entry)}</span>
    </>
  );
  const title = `${entry.title} — ${entry.detail} — ${CALENDAR_STATUS_LABEL[entry.status]}`;

  if (entry.href !== null) {
    return (
      <Link href={entry.href} title={title} className={`${className} hover:underline`}>
        {content}
      </Link>
    );
  }
  return (
    <span title={title} className={className}>
      {content}
    </span>
  );
}

/** One row in the "+N more" dialog: the full title, detail and status, with no poster. */
function DayDialogRow({ entry }: { entry: CalendarEntry }) {
  const Icon: LucideIcon = entry.kind === "movie" ? Film : Tv;
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={entry.title}>
          {entry.href !== null ? (
            <Link href={entry.href} className="hover:underline">
              {entry.title}
            </Link>
          ) : (
            entry.title
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{entry.detail}</p>
      </div>
      <Badge className={CALENDAR_STATUS_CLASS[entry.status]}>{CALENDAR_STATUS_LABEL[entry.status]}</Badge>
    </li>
  );
}

/** Remembers the view for a year. The server reads this cookie, so the next page load renders the same view. */
function rememberView(view: CalendarView) {
  document.cookie = `${CALENDAR_VIEW_COOKIE}=${view}; path=/; max-age=31536000; SameSite=Lax`;
}

/**
 * The Calendar page's interactive part: the view toggle, the filters, and the list or grid. The entries and days
 * arrive already built by the server, so no date is formatted in the browser.
 */
export function CalendarView({
  days,
  entries,
  initialView,
}: {
  days: CalendarDay[];
  entries: CalendarEntry[];
  initialView: CalendarView;
}) {
  const [view, setView] = useState<CalendarView>(initialView);
  const [filters, setFilters] = useState<CalendarFilters>(DEFAULT_FILTERS);
  const posterPreview = usePosterPreview<string>();

  const visible = useMemo(() => filterEntries(entries, filters), [entries, filters]);
  const byDate = useMemo(() => entriesByDate(visible), [visible]);
  // The day whose "+N more" dialog is open, as "YYYY-MM-DD", or null when closed.
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const dialogDay = days.find((day) => day.date === dialogDate) ?? null;
  const dialogEntries = dialogDate !== null ? (byDate.get(dialogDate) ?? []) : [];

  function chooseView(next: CalendarView) {
    setView(next);
    // The grid has no poster rows, so a preview left open from the list would have nothing to belong to.
    posterPreview.clear();
    rememberView(next);
  }

  function updateFilters(patch: Partial<CalendarFilters>) {
    setFilters((previous) => ({ ...previous, ...patch }));
  }

  function toggleReleaseType(releaseType: ReleaseType) {
    const next = filters.releaseTypes.includes(releaseType)
      ? filters.releaseTypes.filter((type) => type !== releaseType)
      : RELEASE_TYPES.filter((type) => type === releaseType || filters.releaseTypes.includes(type));
    updateFilters({ releaseTypes: next });
  }

  // The preview belongs to a row. Hide it when that row is filtered out, so it can't float over nothing.
  const previewVisible =
    posterPreview.activeKey !== null && visible.some((entry) => entry.key === posterPreview.activeKey);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="View" className="flex gap-1">
          <Button
            variant={view === "list" ? "default" : "outline"}
            size="sm"
            aria-pressed={view === "list"}
            onClick={() => chooseView("list")}
          >
            List
          </Button>
          <Button
            variant={view === "grid" ? "default" : "outline"}
            size="sm"
            aria-pressed={view === "grid"}
            onClick={() => chooseView("grid")}
          >
            Grid
          </Button>
        </div>

        <select
          aria-label="Show"
          value={filters.type}
          onChange={(event) => updateFilters({ type: event.target.value as TypeFilter })}
          className={SELECT_CLASS}
        >
          <option value="all">All</option>
          <option value="movies">Movies</option>
          <option value="tv">TV</option>
        </select>

        {filters.type !== "tv" && (
          <fieldset className="flex flex-wrap items-center gap-3 text-sm">
            <legend className="sr-only">Movie release types</legend>
            {RELEASE_TYPES.map((releaseType) => (
              <label key={releaseType} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={filters.releaseTypes.includes(releaseType)}
                  onChange={() => toggleReleaseType(releaseType)}
                  className="size-4 accent-primary"
                />
                {RELEASE_TYPE_LABEL[releaseType]}
              </label>
            ))}
          </fieldset>
        )}

        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={filters.showUnmonitored}
            onChange={(event) => updateFilters({ showUnmonitored: event.target.checked })}
            className="size-4 accent-primary"
          />
          Show unmonitored
        </label>
      </div>

      {visible.length === 0 && <p className="text-sm text-muted-foreground">Nothing in this range.</p>}

      {view === "list" ? (
        <div className="space-y-4">
          {days.map((day) => {
            const dayEntries = byDate.get(day.date) ?? [];
            if (dayEntries.length === 0) return null;
            return (
              <section key={day.date} aria-label={day.label}>
                <h2 className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                  {day.label}
                  {day.isToday && <Badge variant="secondary">Today</Badge>}
                </h2>
                <ul className="divide-y rounded-md border">
                  {dayEntries.map((entry) => (
                    <li
                      key={entry.key}
                      className="flex items-center gap-3 px-3 py-2"
                      {...posterPreview.rowHandlers(entry.key, entry.posterSrc, {
                        title: entry.title,
                        kind: entry.kind === "movie" ? "movie" : "series",
                        peek: entry.peek,
                      })}
                    >
                      <Poster src={entry.posterSrc} />
                      <div className="min-w-0 flex-1" data-poster-anchor>
                        <div className="truncate font-medium" title={entry.title}>
                          {entry.href !== null ? (
                            <Link href={entry.href} className="hover:underline">
                              {entry.title}
                            </Link>
                          ) : (
                            entry.title
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{entry.detail}</p>
                      </div>
                      <Badge variant="outline">{entry.kind === "movie" ? "Movie" : "TV"}</Badge>
                      <Badge className={CALENDAR_STATUS_CLASS[entry.status]}>{CALENDAR_STATUS_LABEL[entry.status]}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        // The grid keeps a minimum width, so on a narrow screen it scrolls sideways rather than squashing the days.
        // Headings and days share one grid, so each weekday heading sits over its column.
        <div className="overflow-x-auto rounded-md border">
          <div className="grid min-w-[48rem] grid-cols-7">
            {WEEKDAY_HEADINGS.map((heading, column) => (
              <div
                key={heading}
                className={cn(
                  "min-w-0 border-b bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground",
                  column < 6 && "border-r",
                )}
              >
                {heading}
              </div>
            ))}
            {days.map((day, index) => {
              const column = index % 7;
              const lastRow = index >= days.length - 7;
              const { shown, hiddenCount } = splitDayChips(byDate.get(day.date) ?? []);
              return (
                <div
                  key={day.date}
                  className={cn(
                    // Tall enough for the day number, three chips and the "+N more" button.
                    "flex h-36 min-w-0 flex-col gap-1 overflow-hidden p-1.5",
                    column < 6 && "border-r",
                    !lastRow && "border-b",
                    WEEKEND_COLUMNS.includes(column) && "bg-muted/30",
                  )}
                >
                  <div className="flex">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs",
                        day.isToday ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground",
                      )}
                    >
                      {day.gridLabel}
                    </span>
                    {/* The corner shows only the day number, so screen readers get the full date and "today" here. */}
                    <span className="sr-only" aria-current={day.isToday ? "date" : undefined}>
                      {day.isToday ? `${day.label}, today` : day.label}
                    </span>
                  </div>
                  {shown.map((entry) => (
                    <GridChip key={entry.key} entry={entry} />
                  ))}
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setDialogDate(day.date)}
                      aria-label={`${day.label}: ${hiddenCount} more`}
                      className="self-start text-xs text-muted-foreground hover:underline"
                    >
                      +{hiddenCount} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={dialogDate !== null} onOpenChange={(open) => !open && setDialogDate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogDay?.label ?? ""}</DialogTitle>
            <DialogDescription className="sr-only">Everything on this day that matches the filters.</DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-md border">
            {dialogEntries.map((entry) => (
              <DayDialogRow key={entry.key} entry={entry} />
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      {previewVisible && posterPreview.preview}
    </div>
  );
}

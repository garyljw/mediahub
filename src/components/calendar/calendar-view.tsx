"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  type CalendarDay,
  type CalendarFilters,
  type CalendarView,
  type TypeFilter,
} from "./calendar-filters";
import { CALENDAR_STATUS_CLASS, CALENDAR_STATUS_EDGE, CALENDAR_STATUS_LABEL } from "./calendar-status";

const RELEASE_TYPE_LABEL: Record<ReleaseType, string> = {
  cinema: "Cinema",
  digital: "Digital",
  physical: "Physical",
};

const WEEKDAY_HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
                      {...posterPreview.rowHandlers(entry.key, entry.posterSrc)}
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
        <div className="overflow-x-auto rounded-md border">
          <div className="min-w-[56rem]">
            <div className="grid grid-cols-7 border-b bg-muted/40 text-xs font-medium text-muted-foreground">
              {WEEKDAY_HEADINGS.map((heading) => (
                <div key={heading} className="px-2 py-1.5">
                  {heading}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => (
                <div
                  key={day.date}
                  className={cn("min-h-28 border-b border-r p-1.5", day.isToday && "bg-primary/5")}
                >
                  <div className={cn("mb-1 text-xs", day.isToday ? "font-semibold text-primary" : "text-muted-foreground")}>
                    {day.label}
                    {day.isToday && " · Today"}
                  </div>
                  <ul className="space-y-1">
                    {(byDate.get(day.date) ?? []).map((entry) => (
                      <li
                        key={entry.key}
                        className={cn("min-w-0 border-l-2 pl-1.5 text-xs", CALENDAR_STATUS_EDGE[entry.status])}
                      >
                        <span className="sr-only">{CALENDAR_STATUS_LABEL[entry.status]}: </span>
                        <span className="block truncate font-medium" title={entry.title}>
                          {entry.href !== null ? (
                            <Link href={entry.href} className="hover:underline">
                              {entry.title}
                            </Link>
                          ) : (
                            entry.title
                          )}
                        </span>
                        <span className="block truncate text-muted-foreground">{entry.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {previewVisible && posterPreview.preview}
    </div>
  );
}

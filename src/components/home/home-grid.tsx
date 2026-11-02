"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Film, Tv } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PosterTile } from "@/components/poster/poster";
import { ACTIVITY_CLASS, ACTIVITY_ICON } from "@/components/library/activity-cell";
import { activityLabel, showsProgress } from "@/components/library/activity";
import { formatCount } from "@/components/library/format";
import { useActivity } from "@/components/library/use-activity";
import { cn } from "@/lib/utils";
import type { QueueActivity } from "@/server/arr/activity";
import { filterHomeItems, HOME_PAGE_SIZE, type HomeItem, type HomeKind } from "./home-items";

const KIND_CHIPS: { kind: HomeKind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "movie", label: "Movies" },
  { kind: "series", label: "TV" },
];

const CHIP_CLASS = "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * The Home poster grid: movies and TV together, with instant search and a kind filter. Read-only. Each tile
 * opens the item's own page. Live activity is polled for both apps, and shown as a line and progress bar.
 */
export function HomeGrid({
  items,
  unavailable,
}: {
  items: HomeItem[];
  /** Kinds whose library failed to load. The page already shows an error for each, so no empty-state text is added. */
  unavailable: HomeItem["kind"][];
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<HomeKind>("all");
  const [visible, setVisible] = useState(HOME_PAGE_SIZE);
  const searchRef = useRef<HTMLInputElement>(null);
  const movieActivity = useActivity("/api/movies/activity");
  const seriesActivity = useActivity("/api/tv/activity");

  // Autofocus the search box on desktop only, so phones don't pop the keyboard.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) searchRef.current?.focus();
  }, []);

  // A new search or filter starts again from the first page.
  const filtered = useMemo(() => filterHomeItems(items, { kind, search }), [items, kind, search]);
  const shown = filtered.slice(0, visible);
  // An empty grid with a failed app in view is explained by the page's error, not by "No matches".
  const failedInView = unavailable.some((failed) => kind === "all" || kind === failed);

  function changeSearch(value: string) {
    setSearch(value);
    setVisible(HOME_PAGE_SIZE);
  }

  function changeKind(next: HomeKind) {
    setKind(next);
    setVisible(HOME_PAGE_SIZE);
  }

  return (
    <div className="space-y-4">
      {movieActivity.failed && <ActivityFailed source="Radarr" />}
      {seriesActivity.failed && <ActivityFailed source="Sonarr" />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(event) => changeSearch(event.target.value)}
          placeholder="Search movies and TV"
          aria-label="Search your library"
          className="sm:max-w-sm"
        />
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {KIND_CHIPS.map((chip) => (
            <button
              key={chip.kind}
              type="button"
              aria-pressed={kind === chip.kind}
              onClick={() => changeKind(chip.kind)}
              className={cn(
                CHIP_CLASS,
                kind === chip.kind
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-accent",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && failedInView ? null : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in your library yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Showing {formatCount(shown.length)} of {formatCount(filtered.length)}
          </p>
          {/* Fixed-width tiles fill each row, so wider screens get more columns rather than bigger posters. */}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-3 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]">
            {shown.map((item) => (
              <li key={item.key}>
                <HomeTile
                  item={item}
                  activity={(item.kind === "movie" ? movieActivity.byId : seriesActivity.byId).get(item.id)}
                />
              </li>
            ))}
          </ul>
          {visible < filtered.length && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setVisible((count) => count + HOME_PAGE_SIZE)}>
                Show more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActivityFailed({ source }: { source: string }) {
  return (
    <p role="status" className="inline-flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
      <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
      Couldn&apos;t update activity from {source}.
    </p>
  );
}

function HomeTile({ item, activity }: { item: HomeItem; activity: QueueActivity | undefined }) {
  const Icon = activity ? ACTIVITY_ICON[activity.state] : null;
  const KindIcon = item.kind === "movie" ? Film : Tv;
  return (
    <Link
      href={item.href}
      className="group block rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="relative overflow-hidden rounded-md transition-transform group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
        <PosterTile src={item.posterSrc} />
        <span className="absolute top-1.5 right-1.5 rounded bg-black/65 p-1 text-white">
          <KindIcon aria-hidden className="size-3" />
          <span className="sr-only">{item.kind === "movie" ? "Movie" : "TV"}</span>
        </span>
        {activity && showsProgress(activity) && (
          <div
            role="progressbar"
            aria-label={`Download progress for ${item.title}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={activity.progress}
            className="absolute inset-x-0 bottom-0 h-1.5 bg-black/50"
          >
            <div className="h-full bg-primary" style={{ width: `${activity.progress}%` }} />
          </div>
        )}
      </div>
      <div className="mt-1.5 space-y-1">
        <p className="truncate text-sm font-medium leading-snug group-hover:underline" title={item.title}>
          {item.title}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
          {item.year !== null && <span>{item.year}</span>}
          <Badge className={cn("h-4 px-1.5 text-[10px]", item.badge.className)}>{item.badge.label}</Badge>
        </div>
        {activity && Icon && (
          <p className={cn("flex min-w-0 items-center gap-1 text-xs", ACTIVITY_CLASS[activity.severity])}>
            <Icon aria-hidden className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{activityLabel(activity)}</span>
          </p>
        )}
      </div>
    </Link>
  );
}

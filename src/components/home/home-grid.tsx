"use client";

import Link from "next/link";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Bookmark, Film, Tv } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PosterTile } from "@/components/poster/poster";
import { ACTIVITY_CLASS, ACTIVITY_ICON } from "@/components/library/activity-cell";
import { activityLabel, showsProgress } from "@/components/library/activity";
import { formatCount } from "@/components/library/format";
import { useActivity } from "@/components/library/use-activity";
import { FOCUS_NAME, SAVE_FAILED } from "@/components/focus/focus-kinds";
import { addFocusItem, removeFocusItems, type FocusResult } from "@/app/(app)/focus/actions";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { QueueActivity } from "@/server/arr/activity";
import { filterHomeItems, WATCHED_CLASS, WATCHED_LABEL, type HomeItem, type HomeKind } from "./home-items";

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
  action,
}: {
  items: HomeItem[];
  /** Kinds whose library failed to load. The page already shows an error for each, so no empty-state text is added. */
  unavailable: HomeItem["kind"][];
  /** Shown at the end of the filter row, e.g. the Add button. */
  action?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<HomeKind>("all");
  const [focusError, setFocusError] = useState<string | null>(null);
  // The tile the open menu is for, by key. Set on the grid's own context-menu or touch-press event (see below).
  const [menuKey, setMenuKey] = useState<string | null>(null);
  // One change at a time per title: while a title's save is pending, its menu item is disabled. The ref blocks a second
  // click before React re-renders; the state disables the item.
  const pendingRef = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Which titles are in a Focus list. It starts from the page's data and changes at once on add or remove, and is
  // rolled back if the save fails. It follows new page data only when that data arrives.
  const [source, setSource] = useState(items);
  const [inFocusKeys, setInFocusKeys] = useState(() => focusKeysOf(items));
  if (source !== items) {
    setSource(items);
    // A title whose save is still pending keeps its optimistic value; the save's own result settles it.
    const next = focusKeysOf(items);
    for (const key of pendingKeys) {
      if (inFocusKeys.has(key)) next.add(key);
      else next.delete(key);
    }
    setInFocusKeys(next);
  }
  const searchRef = useRef<HTMLInputElement>(null);
  const movieActivity = useActivity("/api/movies/activity");
  const seriesActivity = useActivity("/api/tv/activity");

  // Autofocus the search box on desktop only, so phones don't pop the keyboard.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) searchRef.current?.focus();
  }, []);

  // Every match shows at once: no paging. Posters load lazily as they scroll into view. The grid follows a
  // deferred copy of the search, so typing stays responsive while a large grid re-renders.
  const deferredSearch = useDeferredValue(search);
  // The items with the local in-focus state applied. An item whose state didn't change keeps its object, so the
  // memoised tiles skip re-rendering.
  const shown = useMemo(
    () =>
      items.map((item) => {
        const inFocus = inFocusKeys.has(item.key);
        return inFocus === item.inFocus ? item : { ...item, inFocus };
      }),
    [items, inFocusKeys],
  );
  const shownByKey = useMemo(() => new Map(shown.map((item) => [item.key, item])), [shown]);
  const menuTarget = menuKey === null ? undefined : shownByKey.get(menuKey);
  const filtered = useMemo(() => filterHomeItems(shown, { kind, search: deferredSearch }), [shown, kind, deferredSearch]);
  const filtering = kind !== "all" || deferredSearch.trim() !== "";
  // An empty grid with a failed app in view is explained by the page's error, not by "No matches".
  const failedInView = unavailable.some((failed) => kind === "all" || kind === failed);

  /** The tile under a pointer or keyboard event, from its data-focus-key, or null when the event is between tiles. */
  function tileKeyAt(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>("[data-focus-key]")?.dataset.focusKey ?? null;
  }

  /**
   * Adds or removes a title from its Focus list. The local state changes at once. A refusal or error restores that
   * title's value from before this request, and shows the error.
   */
  async function changeFocus(item: HomeItem, add: boolean) {
    if (pendingRef.current.has(item.key)) return;
    const wasInFocus = inFocusKeys.has(item.key);
    pendingRef.current.add(item.key);
    setPendingKeys(new Set(pendingRef.current));
    setFocusError(null);
    setInFocusKeys((prev) => withKey(prev, item.key, add));

    let result: FocusResult;
    try {
      result = add
        ? await addFocusItem({ kind: item.kind, id: item.id })
        : await removeFocusItems({ kind: item.kind, ids: [item.id] });
    } catch {
      result = { ok: false, error: SAVE_FAILED };
    }

    pendingRef.current.delete(item.key);
    setPendingKeys(new Set(pendingRef.current));
    if (!result.ok) {
      setInFocusKeys((prev) => withKey(prev, item.key, wasInFocus));
      setFocusError(result.error);
    }
  }

  return (
    <div className="space-y-4">
      {movieActivity.failed && <ActivityFailed source="Radarr" />}
      {seriesActivity.failed && <ActivityFailed source="Sonarr" />}
      {focusError && (
        <p role="alert" className="text-sm text-destructive">
          {focusError}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search movies and TV"
          aria-label="Search your library"
          className="sm:max-w-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            {KIND_CHIPS.map((chip) => (
              <button
                key={chip.kind}
                type="button"
                aria-pressed={kind === chip.kind}
                onClick={() => setKind(chip.kind)}
                className={cn(
                  CHIP_CLASS,
                  kind === chip.kind
                    ? "border-transparent bg-brand text-primary-foreground glow-brand"
                    : "border-border bg-background text-foreground hover:bg-accent",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
          {action}
        </div>
      </div>

      {filtered.length === 0 && failedInView ? null : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in your library yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {filtering
              ? `${formatCount(filtered.length)} of ${formatCount(items.length)}`
              : `${formatCount(items.length)} ${items.length === 1 ? "title" : "titles"}`}
          </p>
          {/* One menu for the whole grid. Its trigger is the grid, so a tile's menu opens from the tile the press or click
              was on, and a press or click between tiles opens no menu. */}
          <ContextMenu>
            <ContextMenuTrigger
              asChild
              onPointerDownCapture={(event) => {
                // Touch and pen only (a mouse press opens the menu on contextmenu). Set the tile first, so the menu Radix
                // opens after the long press is for the right title. A press between tiles gets preventDefault, which
                // stops Radix's long-press timer for it.
                if (event.pointerType === "mouse") return;
                const key = tileKeyAt(event.target);
                setMenuKey(key);
                if (key === null) event.preventDefault();
              }}
              onContextMenu={(event) => {
                const key = tileKeyAt(event.target);
                if (key === null) {
                  // Between tiles: no menu, and no native browser menu either.
                  event.preventDefault();
                  return;
                }
                setMenuKey(key);
              }}
            >
              {/* Fixed-width tiles fill each row, so wider screens get more columns rather than bigger posters. */}
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-3 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]">
                {filtered.map((item) => (
                  // content-visibility lets the browser skip layout and paint for tiles that are off screen.
                  <li
                    key={item.key}
                    data-focus-key={item.key}
                    className="[contain-intrinsic-size:auto_15rem] [content-visibility:auto]"
                  >
                    <HomeTile
                      item={item}
                      activity={(item.kind === "movie" ? movieActivity.byId : seriesActivity.byId).get(item.id)}
                    />
                  </li>
                ))}
              </ul>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {menuTarget && (
                <ContextMenuItem
                  disabled={pendingKeys.has(menuTarget.key)}
                  onSelect={() => void changeFocus(menuTarget, !menuTarget.inFocus)}
                >
                  {menuTarget.inFocus ? `Remove from ${FOCUS_NAME[menuTarget.kind]}` : `Add to ${FOCUS_NAME[menuTarget.kind]}`}
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
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

/**
 * One poster tile: the Home grid's look, also used by the Focus pages. The link is not draggable and the poster ignores
 * pointer input, so a press-and-drag (on a Focus page) isn't taken over by the browser's own link or image drag.
 * `showFocusMarker` hides the corner marker where every tile is already in a Focus list.
 * Memoised because every match renders at once: an activity poll then skips the tiles with no activity. Keep it free of
 * per-tile callbacks, so the memo holds.
 */
export const HomeTile = memo(function HomeTile({
  item,
  activity,
  showFocusMarker = true,
}: {
  item: HomeItem;
  activity: QueueActivity | undefined;
  showFocusMarker?: boolean;
}) {
  const Icon = activity ? ACTIVITY_ICON[activity.state] : null;
  const KindIcon = item.kind === "movie" ? Film : Tv;
  return (
    <Link
      href={item.href}
      draggable={false}
      className="group block rounded-lg select-none [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {/* The hover ring and glow sit inside the poster: the grid's content-visibility clips anything drawn outside a tile. */}
      <div className="relative overflow-hidden rounded-md transition-transform group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100 [&_img]:pointer-events-none after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:opacity-0 after:shadow-[inset_0_0_0_2px_var(--primary),inset_0_0_28px_-6px_var(--glow)] after:transition-opacity group-hover:after:opacity-100 group-focus-visible:after:opacity-100">
        <PosterTile src={item.posterSrc} />
        {showFocusMarker && item.inFocus && (
          <span className="absolute top-1.5 left-1.5 rounded bg-brand glow-brand p-1 text-white">
            <Bookmark aria-hidden className="size-3" />
            <span className="sr-only">In {FOCUS_NAME[item.kind]}</span>
          </span>
        )}
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
            // Sits above the watched banner, so both stay visible.
            className={cn("absolute inset-x-0 h-1.5 bg-black/50", item.watched ? "bottom-5" : "bottom-0")}
          >
            <div className="h-full bg-brand" style={{ width: `${activity.progress}%` }} />
          </div>
        )}
        {item.watched && (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 flex h-5 items-center justify-center text-[10px] font-semibold tracking-wide uppercase",
              WATCHED_CLASS[item.watched],
            )}
          >
            {WATCHED_LABEL[item.watched]}
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
});

function focusKeysOf(items: HomeItem[]): Set<string> {
  return new Set(items.filter((item) => item.inFocus).map((item) => item.key));
}

function withKey(keys: ReadonlySet<string>, key: string, on: boolean): Set<string> {
  const next = new Set(keys);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

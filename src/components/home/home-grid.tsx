"use client";

import Link from "next/link";
import { memo, Suspense, use, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Bookmark, Film, Tv } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PosterTile } from "@/components/poster/poster";
import { POSTER_GRID_CLASS, POSTER_TILE_CLASS } from "@/components/poster/poster-grid";
import { ACTIVITY_CLASS, ACTIVITY_ICON } from "@/components/library/activity-cell";
import { activityLabel, showsProgress } from "@/components/library/activity";
import { formatCount } from "@/components/library/format";
import { SELECT_CLASS } from "@/components/library/table-parts";
import { useActivity } from "@/components/library/use-activity";
import { FOCUS_NAME, SAVE_FAILED } from "@/components/focus/focus-kinds";
import { addFocusItem, removeFocusItems, type FocusResult } from "@/app/(app)/focus/actions";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useTilePeek } from "./tile-peek";
import { LetterBar } from "./letter-bar";
import { letterIndex } from "./letter";
import { readPlace, usePlaceMemory } from "./return-place";
import { cn } from "@/lib/utils";
import type { QueueActivity } from "@/server/arr/activity";
import { HomeGridSkeleton } from "@/components/skeletons/page-skeletons";
import {
  DEFAULT_HOME_SORT,
  filterHomeItems,
  HOME_SORTS,
  readHomeSort,
  saveHomeSort,
  sortHomeItems,
  WATCH_FILTER_CHIPS,
  WATCHED_CLASS,
  WATCHED_LABEL,
  withDownloaded,
  withWatched,
  type HomeDownloaded,
  type HomeDownloadDate,
  type HomeItem,
  type HomeKind,
  type HomeLibrary,
  type HomeSortDir,
  type HomeSortKey,
  type HomeWatched,
  type HomeWatchFilter,
  type WatchedState,
} from "./home-items";

const KIND_CHIPS: { kind: HomeKind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "movie", label: "Movies" },
  { kind: "series", label: "TV" },
];

const CHIP_CLASS = "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** A filter chip's classes, selected or not. Shared by the kind and watch-status chips so they stay alike. */
function chipClass(selected: boolean): string {
  return cn(
    CHIP_CLASS,
    selected ? "border-transparent bg-brand text-primary-foreground glow-brand" : "border-border bg-background text-foreground hover:bg-accent",
  );
}

/**
 * The Home poster grid: movies and TV together, with instant search, a kind filter, a watch-status filter and a sort.
 * Read-only. Each tile opens the item's own page. Live activity is polled for both apps, and shown as a line and
 * progress bar.
 *
 * The toolbar renders at once. The tiles arrive with the library (Radarr and Sonarr). The watched status arrives on
 * its own (Plex): the banners and the watch chips fill in when it does. The series download dates arrive on their own
 * too (Sonarr's episode files), and the "Date downloaded" sort is off until they do.
 *
 * The sort starts at A–Z so the server and the browser render the same grid, then switches to the choice saved in this
 * browser once it mounts.
 */
export function HomeGrid({
  library,
  watched,
  downloaded,
  plexConnected,
  action,
}: {
  /** The library, from the page. Resolves once Radarr and Sonarr have answered. Never rejects. */
  library: Promise<HomeLibrary>;
  /** The Plex watched status, from the page. Resolves once Plex has answered. Never rejects. */
  watched: Promise<HomeWatched>;
  /** The series download dates, from the page. Resolves once Sonarr's episode files have answered. Never rejects. */
  downloaded: Promise<HomeDownloaded>;
  /** True when a Plex data connection is set up, so the watch chips are worth showing (disabled) while Plex loads. */
  plexConnected: boolean;
  /** Shown at the end of the filter row, e.g. the Add button. */
  action?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<HomeKind>("all");
  const [watchFilter, setWatchFilter] = useState<HomeWatchFilter>("any");
  // Null until Plex answers. Read in an effect rather than with use(), so the toolbar and grid don't wait for it.
  const [watchedState, setWatchedState] = useState<HomeWatched | null>(null);
  // Null until the download dates arrive. Read in an effect, like the watched status.
  const [downloadedState, setDownloadedState] = useState<HomeDownloaded | null>(null);
  // The default until the saved choice is read on mount, so the first render matches the server's.
  const [sort, setSort] = useState<{ key: HomeSortKey; dir: HomeSortDir }>(DEFAULT_HOME_SORT);
  // Set once the saved sort, filter and place are read. The grid then restores its scroll position once the tiles show.
  const [placeReady, setPlaceReady] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Autofocus the search box on desktop only, so phones don't pop the keyboard.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) searchRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    watched.then((value) => {
      if (!cancelled) setWatchedState(value);
    });
    return () => {
      cancelled = true;
    };
  }, [watched]);

  useEffect(() => {
    let cancelled = false;
    downloaded.then((value) => {
      if (!cancelled) setDownloadedState(value);
    });
    return () => {
      cancelled = true;
    };
  }, [downloaded]);

  // Read after mount, not during render: the saved sort, filter and place are in the browser, and the server must render
  // the defaults. The place's search and filter are applied here too, so the grid comes back as it was left.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setSort(readHomeSort());
      const filter = readPlace("/")?.filter;
      if (filter) {
        setSearch(filter.search);
        setKind(filter.kind);
        setWatchFilter(filter.watched);
      }
      setPlaceReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Picking a sort starts it in that sort's own direction. The new choice is remembered in this browser.
  function chooseSort(key: HomeSortKey) {
    const dir = HOME_SORTS.find((option) => option.key === key)?.defaultDir ?? "asc";
    setSort({ key, dir });
    saveHomeSort({ key, dir });
  }

  function flipSortDir() {
    const dir: HomeSortDir = sort.dir === "asc" ? "desc" : "asc";
    setSort({ key: sort.key, dir });
    saveHomeSort({ key: sort.key, dir });
  }

  // While Plex is loading the chips show, disabled, but only when a Plex connection is set up, so a MediaHub without
  // Plex never shows them. They hide when Plex failed or matched nothing.
  // byKey only holds the items Plex matched, so an empty byKey means no item has a watched state.
  const watchFilterLoading = watchedState === null;
  const watchFilterShown =
    (watchedState === null && plexConnected) || (watchedState?.state === "ready" && Object.keys(watchedState.byKey).length > 0);
  // Reset to "any" when the chips hide, so a choice can't silently re-apply when Plex data comes back.
  if (!watchFilterShown && watchFilter !== "any") setWatchFilter("any");
  const activeWatch: HomeWatchFilter = watchFilterShown ? watchFilter : "any";
  const watchedByKey = watchedState?.state === "ready" ? watchedState.byKey : null;
  const downloadedByKey = downloadedState?.state === "ready" ? downloadedState.byKey : null;
  // The scroll position is restored only once the grid shows what it did: the watch filter needs the Plex data, and
  // the "Date downloaded" sort needs the download dates.
  const restoreReady =
    placeReady && (activeWatch === "any" || watchedState !== null) && (sort.key !== "downloaded" || downloadedState !== null);
  const { onGridClick, restore } = usePlaceMemory("/", { search, kind, watched: activeWatch });

  return (
    <div className="space-y-4" onClickCapture={onGridClick}>
      {watchedState?.state === "failed" && (
        <p role="status" className="inline-flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
          Couldn&apos;t load watched status from Plex.
        </p>
      )}
      {(downloadedState?.state === "failed" || (downloadedState?.state === "ready" && downloadedState.incomplete)) && (
        <p role="status" className="inline-flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
          Couldn&apos;t load some download dates from Radarr, Sonarr or Plex. Those titles may sort lower by date downloaded.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
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
                className={chipClass(kind === chip.kind)}
              >
                {chip.label}
              </button>
            ))}
          </div>
          {watchFilterShown && (
            <>
              <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
              <div role="group" aria-label="Watched in Plex" className="flex flex-wrap gap-2">
                {WATCH_FILTER_CHIPS.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    disabled={watchFilterLoading}
                    aria-disabled={watchFilterLoading || undefined}
                    aria-pressed={watchFilter === chip.value}
                    onClick={() => setWatchFilter(chip.value)}
                    className={cn(chipClass(watchFilter === chip.value), "aria-disabled:opacity-50")}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Sort by"
              value={sort.key}
              onChange={(event) => chooseSort(event.target.value as HomeSortKey)}
              className={SELECT_CLASS}
            >
              {HOME_SORTS.map((option) => (
                <option key={option.key} value={option.key} disabled={option.key === "downloaded" && downloadedState === null}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={flipSortDir}
              aria-label={sort.dir === "asc" ? "Ascending" : "Descending"}
              title={sort.dir === "asc" ? "Ascending. Click to sort descending" : "Descending. Click to sort ascending"}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-transparent shadow-xs outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {sort.dir === "asc" ? <ArrowUp aria-hidden className="size-4" /> : <ArrowDown aria-hidden className="size-4" />}
            </button>
          </div>
          {action}
        </div>
      </div>

      <Suspense fallback={<HomeGridSkeleton />}>
        <HomeResults
          library={library}
          watchedByKey={watchedByKey}
          search={search}
          kind={kind}
          watchFilter={activeWatch}
          sortKey={sort.key}
          sortDir={sort.dir}
          downloadedByKey={downloadedByKey}
          restoreReady={restoreReady}
          onRestore={restore}
        />
      </Suspense>
    </div>
  );
}

/**
 * The part of the grid that needs the library: the error lines, the count, and the tiles. It suspends until Radarr and
 * Sonarr have answered, and the toolbar above stays usable meanwhile. Its own state (Focus changes, menus) lives here.
 */
function HomeResults({
  library: libraryPromise,
  watchedByKey,
  search,
  kind,
  watchFilter,
  sortKey,
  sortDir,
  downloadedByKey,
  restoreReady,
  onRestore,
}: {
  library: Promise<HomeLibrary>;
  watchedByKey: Record<string, WatchedState> | null;
  search: string;
  kind: HomeKind;
  watchFilter: HomeWatchFilter;
  sortKey: HomeSortKey;
  sortDir: HomeSortDir;
  downloadedByKey: Record<string, HomeDownloadDate> | null;
  /** True once the toolbar's saved state is in, so the tiles are the ones the place was saved with. */
  restoreReady: boolean;
  /** Puts the page back where it was saved. Runs once, after the tiles show. */
  onRestore: () => void;
}) {
  const library = use(libraryPromise);
  const base = library.items;
  const unavailable: HomeItem["kind"][] = [...(library.moviesFailed ? ["movie" as const] : []), ...(library.seriesFailed ? ["series" as const] : [])];
  const items = useMemo(
    () => withDownloaded(withWatched(base, watchedByKey), downloadedByKey),
    [base, watchedByKey, downloadedByKey],
  );

  const [focusError, setFocusError] = useState<string | null>(null);
  // The tile the open menu is for, by key. Set on the grid's own context-menu or touch-press event (see below).
  const [menuKey, setMenuKey] = useState<string | null>(null);
  // One change at a time per title: while a title's save is pending, its menu item is disabled. The ref blocks a second
  // click before React re-renders; the state disables the item.
  const pendingRef = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Which titles are in a Focus list. It starts from the page's data and changes at once on add or remove, and is
  // rolled back if the save fails. It follows new page data only when that data arrives.
  const [source, setSource] = useState(base);
  const [inFocusKeys, setInFocusKeys] = useState(() => focusKeysOf(base));
  if (source !== base) {
    setSource(base);
    // A title whose save is still pending keeps its optimistic value; the save's own result settles it.
    const next = focusKeysOf(base);
    for (const key of pendingKeys) {
      if (inFocusKeys.has(key)) next.add(key);
      else next.delete(key);
    }
    setInFocusKeys(next);
  }
  const movieActivity = useActivity("/api/movies/activity");
  const seriesActivity = useActivity("/api/tv/activity");

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
  // The hover card for a tile. Its handlers go on the grid <ul>, next to the ContextMenu trigger's own handlers.
  const { gridHandlers, card } = useTilePeek((key) => shownByKey.get(key));
  const menuTarget = menuKey === null ? undefined : shownByKey.get(menuKey);
  // The matches, in the chosen order. Sorting returns new arrays of the same item objects, so the tiles still skip re-renders.
  const ordered = useMemo(
    () => sortHomeItems(filterHomeItems(shown, { kind, search: deferredSearch, watched: watchFilter }), sortKey, sortDir),
    [shown, kind, deferredSearch, watchFilter, sortKey, sortDir],
  );
  const filtering = kind !== "all" || deferredSearch.trim() !== "" || watchFilter !== "any";
  // The grid follows the deferred search, so wait until it has caught up with the box before restoring the position.
  const searchSettled = deferredSearch === search;
  useEffect(() => {
    if (restoreReady && searchSettled) onRestore();
  }, [restoreReady, searchSettled, ordered, onRestore]);
  // The A–Z bar, when sorted by title and something shows.
  const letters = sortKey === "title" && ordered.length > 0 ? letterIndex(ordered) : null;
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
    <>
      {library.moviesFailed && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load movies from Radarr.
        </p>
      )}
      {library.seriesFailed && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load TV from Sonarr.
        </p>
      )}
      {movieActivity.failed && <ActivityFailed source="Radarr" />}
      {seriesActivity.failed && <ActivityFailed source="Sonarr" />}
      {focusError && (
        <p role="alert" className="text-sm text-destructive">
          {focusError}
        </p>
      )}

      {ordered.length === 0 && failedInView ? null : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in your library yet.</p>
      ) : ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {filtering
              ? `${formatCount(ordered.length)} of ${formatCount(items.length)}`
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
              {/* Tiles are at least 6.5rem, or from sm up 7vw or 8rem, whichever is wider. Wide windows get bigger posters,
                  not just more columns. The skeleton uses the same class, so the tiles don't jump when it's replaced. */}
              <ul {...gridHandlers} className={cn(POSTER_GRID_CLASS, letters && "pr-7")}>
                {ordered.map((item) => (
                  // content-visibility lets the browser skip layout and paint for tiles that are off screen.
                  <li
                    key={item.key}
                    data-focus-key={item.key}
                    className={POSTER_TILE_CLASS}
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
          {letters && <LetterBar dir={sortDir} index={letters} />}
          {card}
        </>
      )}
    </>
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
      data-peek-key={item.key}
      draggable={false}
      className="group block rounded-lg select-none [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {/* No file on disk: the poster is shown in greyscale so missing titles stand out. The badge below still names the status. */}
      <div
        data-peek-anchor
        className={cn(
          "relative overflow-hidden rounded-md [&_img]:pointer-events-none [&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-[1.05] motion-reduce:[&_img]:transition-none motion-reduce:group-hover:[&_img]:scale-100",
          !item.onDisk && "[&_img]:grayscale [&_img]:brightness-90",
        )}
      >
        <PosterTile src={item.posterSrc} />
        {/* The grid's content-visibility clips anything drawn outside a tile, so on hover the frame stays put: the picture zooms
            inside it and the ring and glow are inset. z-10 puts the ring over the badges. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 rounded-md opacity-0 poster-glow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
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

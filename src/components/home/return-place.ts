// Where a list page (Home, Movie Focus, TV Focus) was, so going to a title and back returns to the same place. Also
// the "← Back" target on a title's page. Client-safe: browser storage and window only, no runtime imports from src/server.
import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { FOCUS_NAME } from "@/components/focus/focus-kinds";
import { WATCH_FILTER_CHIPS, type HomeKind, type HomeWatchFilter } from "./home-items";

/** The three pages that are lists of tiles, and that remember a place. */
export const LIST_PATHS = ["/", "/focus/movies", "/focus/tv"] as const;
export type ListPath = (typeof LIST_PATHS)[number];

export function isListPath(value: string): value is ListPath {
  return (LIST_PATHS as readonly string[]).includes(value);
}

/** The Home search and filter choices, remembered with the place so coming back shows the same list. */
export type HomeFilterPlace = { search: string; kind: HomeKind; watched: HomeWatchFilter };

/**
 * A saved place. `tileKey` and `tileTop` name the tile the user clicked and where it sat in the viewport (both null when
 * the place is only a scroll position). `filter` is set for Home only.
 */
export type Place = { scrollY: number; tileKey: string | null; tileTop: number | null; filter: HomeFilterPlace | null };

const KINDS: readonly HomeKind[] = ["all", "movie", "series"];
const WATCH_VALUES: readonly HomeWatchFilter[] = WATCH_FILTER_CHIPS.map((chip) => chip.value);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseFilter(value: unknown): HomeFilterPlace | null {
  if (typeof value !== "object" || value === null) return null;
  const { search, kind, watched } = value as Record<string, unknown>;
  if (typeof search !== "string") return null;
  if (!KINDS.includes(kind as HomeKind)) return null;
  if (!WATCH_VALUES.includes(watched as HomeWatchFilter)) return null;
  return { search, kind: kind as HomeKind, watched: watched as HomeWatchFilter };
}

/** A place read from storage, or null when the value isn't one this code wrote. */
function parsePlace(value: unknown): Place | null {
  if (typeof value !== "object" || value === null) return null;
  const { scrollY, tileKey, tileTop, filter } = value as Record<string, unknown>;
  if (!isFiniteNumber(scrollY) || scrollY < 0) return null;
  if (tileKey !== null && typeof tileKey !== "string") return null;
  if (tileTop !== null && !isFiniteNumber(tileTop)) return null;
  if (filter === null) return { scrollY, tileKey, tileTop, filter: null };
  const parsed = parseFilter(filter);
  return parsed === null ? null : { scrollY, tileKey, tileTop, filter: parsed };
}

function placeKey(listPath: ListPath): string {
  return `mediahub.place:${listPath}`;
}

/** The saved place for a list page, or null when there is none, the stored text is junk, or storage is unavailable. */
export function readPlace(listPath: ListPath): Place | null {
  try {
    const raw = globalThis.sessionStorage.getItem(placeKey(listPath));
    return raw === null ? null : parsePlace(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Saves a list page's place. Storage can be missing or throw (private mode), in which case nothing is remembered. */
export function writePlace(listPath: ListPath, place: Place): void {
  try {
    globalThis.sessionStorage.setItem(placeKey(listPath), JSON.stringify(place));
  } catch {
    // Not remembered this time.
  }
}

function clearPlace(listPath: ListPath): void {
  try {
    globalThis.sessionStorage.removeItem(placeKey(listPath));
  } catch {
    // Nothing to clear.
  }
}

/** The list a title's page was opened from, and that title's own path (e.g. "/movies/12"). */
export type BackFrom = { list: ListPath; itemPath: string };

const BACK_FROM_KEY = "mediahub.backFrom";

/** The saved "came from" record, or null when there is none or it isn't valid. */
export function readBackFrom(): BackFrom | null {
  try {
    const parsed: unknown = JSON.parse(globalThis.sessionStorage.getItem(BACK_FROM_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return null;
    const { list, itemPath } = parsed as Record<string, unknown>;
    if (typeof list !== "string" || !isListPath(list)) return null;
    if (typeof itemPath !== "string" || !itemPath.startsWith("/")) return null;
    return { list, itemPath };
  } catch {
    return null;
  }
}

function writeBackFrom(value: BackFrom): void {
  try {
    globalThis.sessionStorage.setItem(BACK_FROM_KEY, JSON.stringify(value));
  } catch {
    // Not remembered: the title's page then links to Home.
  }
}

/**
 * True when the page now open is neither the list nor the title the record was saved for, so the record is stale: the
 * user went somewhere else, and a later visit to that title (from Queue, a link or the address bar) must not "go back".
 */
export function isStaleBackFrom(stored: BackFrom | null, pathname: string): boolean {
  return stored !== null && pathname !== stored.list && pathname !== stored.itemPath;
}

/** Forgets the "came from" record once the user has gone somewhere other than its list or title. Used by the nav. */
export function useForgetStaleBackFrom(pathname: string): void {
  useEffect(() => {
    if (!isStaleBackFrom(readBackFrom(), pathname)) return;
    try {
      globalThis.sessionStorage.removeItem(BACK_FROM_KEY);
    } catch {
      // Storage unavailable: nothing was remembered either.
    }
  }, [pathname]);
}

/** True for a plain left click: a click with a modifier key or another button opens a new tab or window instead. */
export function isPlainClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** The label each list page shows on a title's page: "← Home", "← Movie Focus" or "← TV Focus". */
export const LIST_LABEL: Record<ListPath, string> = {
  "/": "Home",
  "/focus/movies": FOCUS_NAME.movie,
  "/focus/tv": FOCUS_NAME.series,
};

export type BackTarget = { mode: "back"; list: ListPath; label: string } | { mode: "link"; href: "/"; label: "Home" };

/**
 * Where a title's back link goes. When the list the user came from is the one that opened this title, it goes back in
 * the history to that list. Otherwise it links to Home.
 */
export function backTarget(stored: BackFrom | null, pathname: string): BackTarget {
  if (stored !== null && stored.itemPath === pathname) {
    return { mode: "back", list: stored.list, label: LIST_LABEL[stored.list] };
  }
  return { mode: "link", href: "/", label: "Home" };
}

/**
 * The scroll position that puts a tile at the same place in the viewport as when it was saved. Never above the top of
 * the page.
 */
export function restoreTop(tileDocTop: number, savedTileTop: number): number {
  return Math.max(0, tileDocTop - savedTileTop);
}

/** The tile with this key, or null when it isn't on the page. */
export function findTile(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
}

/**
 * Goes to the top of a list page that is already open, and forgets its place. Smooth, unless the user asks for reduced
 * motion.
 */
export function returnToTop(listPath: ListPath): void {
  clearPlace(listPath);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
}

/**
 * Tiles off screen use content-visibility, so their position is an estimate until they are laid out. One frame after a
 * jump, measure again and correct, so the tile ends up where it should be.
 */
export function settleOn(tile: Element, viewportTop: number): void {
  requestAnimationFrame(() => {
    const drift = tile.getBoundingClientRect().top - viewportTop;
    if (Math.abs(drift) > 2) window.scrollTo({ top: Math.max(0, window.scrollY + drift), behavior: "instant" });
  });
}

/**
 * For a nav link's click: when the link is the list page already open, goes to its top instead of navigating and
 * returns true, so the caller can stop the link. Otherwise returns false.
 */
export function topIfOpen(href: string, pathname: string): boolean {
  if (!isListPath(href) || href !== pathname) return false;
  returnToTop(href);
  return true;
}

// The path the document was loaded on, read once when this module first runs in the browser. The first visit to that
// path is the landing (a fresh open or a reload); every later visit to a list came from another page in the app.
const landingPath = typeof window === "undefined" ? null : window.location.pathname;
let landingSeen = false;

function isDocumentLanding(listPath: ListPath): boolean {
  if (landingSeen || listPath !== landingPath) return false;
  landingSeen = true;
  return true;
}

/** True when the document was loaded by a reload, so the place saved as the page unloaded should come back. */
function isReload(): boolean {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return entry?.type === "reload";
  } catch {
    return false;
  }
}

/** The first tile whose top is on screen (or the last one above it), as a key and its top in the viewport. */
function firstVisibleTile(): { tileKey: string; tileTop: number } | null {
  for (const tile of document.querySelectorAll<HTMLElement>("[data-focus-key]")) {
    const top = tile.getBoundingClientRect().top;
    if (top >= 0 && tile.dataset.focusKey) return { tileKey: tile.dataset.focusKey, tileTop: top };
  }
  return null;
}

/**
 * Keeps the restored position for a moment. Safari restores its own idea of the scroll position a little after a Back
 * navigation, and late layout can move the page too, so for a short while any move the user didn't make is undone.
 */
function holdPosition(target: () => number, userMoved: () => boolean, ms = 1000): void {
  const until = performance.now() + ms;
  const check = () => {
    if (userMoved() || performance.now() > until) {
      window.removeEventListener("scroll", check);
      return;
    }
    const top = target();
    if (Math.abs(window.scrollY - top) > 2) window.scrollTo({ top, behavior: "instant" });
  };
  window.addEventListener("scroll", check, { passive: true });
  requestAnimationFrame(check);
  setTimeout(check, 150);
  setTimeout(() => {
    check();
    window.removeEventListener("scroll", check);
  }, ms);
}

// Input that scrolls the page by hand. Anything else that moves the page while it loads is not the user.
const INPUT_EVENTS = ["wheel", "touchmove", "keydown"] as const;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/**
 * Remembers a list page's place and brings it back, once per visit. Returns a click handler for the grid (it saves the
 * tile that was clicked, and the title's back target) and `restore`, which the grid calls once its tiles are on the page.
 * The place is also saved when the page unmounts, with the last scroll position. `filter` is the Home filter, or null.
 */
export function usePlaceMemory(listPath: ListPath, filter: HomeFilterPlace | null) {
  const lastY = useRef<number | null>(null);
  // Set when the user scrolls by hand before the tiles are ready. Only real input counts: the page also moves on its own
  // while it loads (the browser clamps or restores the scroll position as the content changes height).
  const interacted = useRef(false);
  const restored = useRef(false);
  // The filter as it is now, so leaving the page (not only clicking a tile) saves the current search and chips.
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  });

  useEffect(() => {
    const onScroll = () => {
      lastY.current = window.scrollY;
    };
    const onInput = (event: Event) => {
      if (event instanceof KeyboardEvent && !SCROLL_KEYS.has(event.key)) return;
      interacted.current = true;
    };
    // A reload or a closed tab runs no React cleanup, so the place is saved as the page unloads, for a reload to restore.
    const onPageHide = () => {
      const tile = firstVisibleTile();
      writePlace(listPath, {
        scrollY: window.scrollY,
        tileKey: tile?.tileKey ?? null,
        tileTop: tile?.tileTop ?? null,
        filter: filterRef.current,
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput);
      // Next keeps a page you leave alive but hidden, and runs its effects again when you come back, without a new
      // mount. Reset here, so the next visit restores again. (The grid's restore effect runs before this hook's setup
      // on the way back, so resetting in the setup would be too late.)
      restored.current = false;
      interacted.current = false;
      // Only when the user has scrolled here. A page that never scrolled keeps the place it already has.
      if (lastY.current === null) return;
      const saved = readPlace(listPath);
      writePlace(listPath, {
        scrollY: lastY.current,
        tileKey: saved?.tileKey ?? null,
        tileTop: saved?.tileTop ?? null,
        filter: filterRef.current ?? saved?.filter ?? null,
      });
    };
  }, [listPath]);

  const restore = useCallback(() => {
    if (restored.current) return;
    restored.current = true;
    // A fresh open of the list starts at the top. A reload comes back to where the page was as it unloaded, and a return
    // from another page in the app to the tile that was opened.
    if (isDocumentLanding(listPath) && !isReload()) return;
    const place = readPlace(listPath);
    if (place === null) return;
    // The user scrolled before the tiles were ready: leave the page where they put it.
    if (interacted.current) return;
    const tile = place.tileKey === null ? null : findTile(place.tileKey);
    const tileTop = place.tileTop;
    // Measured each time, because off-screen tiles' positions are estimates until they are laid out.
    const target = () =>
      tile !== null && tileTop !== null
        ? restoreTop(tile.getBoundingClientRect().top + window.scrollY, tileTop)
        : place.scrollY;
    window.scrollTo({ top: target(), behavior: "instant" });
    lastY.current = window.scrollY;
    holdPosition(target, () => interacted.current);
  }, [listPath]);

  function onGridClick(event: MouseEvent<HTMLElement>) {
    // Only a click on the tile's own link counts: a tile's ⋯ button or menu is not a visit to the title.
    const target = event.target;
    const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
    const tile = link?.closest<HTMLElement>("[data-focus-key]");
    const tileKey = tile?.dataset.focusKey;
    const itemPath = link?.getAttribute("href");
    if (!tile || tileKey === undefined || !itemPath) return;
    writePlace(listPath, { scrollY: window.scrollY, tileKey, tileTop: tile.getBoundingClientRect().top, filter });
    writeBackFrom({ list: listPath, itemPath });
  }

  return { onGridClick, restore };
}

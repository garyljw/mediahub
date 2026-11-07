"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEventHandler } from "react";
import { createPortal } from "react-dom";
import { usePosterHues } from "@/components/poster/use-poster-hues";
import type { PosterHues } from "@/components/poster/poster-hues";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Peek } from "@/server/merge/peek";

/** What a tile needs for its hover card. HomeItem has all of these. */
export type TilePeekItem = {
  key: string;
  kind: "movie" | "series";
  id: number;
  title: string;
  posterSrc: string | null;
  /** False for a title with nothing on disk: its card poster is greyscale, like its tile. */
  onDisk?: boolean;
};

/** How long the pointer rests on a tile before its card opens. */
const HOVER_DELAY_MS = 500;
/**
 * How long the pointer must rest before the text is requested. Sweeping across the grid passes each tile faster than
 * this, so it asks Radarr and Sonarr nothing. The rest of HOVER_DELAY_MS is left for the answer to arrive.
 */
const PREFETCH_DELAY_MS = 150;
/** The poster grows to this scale from its centre when the card opens. */
const POSTER_SCALE = 1.06;
const PANEL_WIDTH = 260;
/** The gap between the poster and the text panel. The wrapper's flex gap uses the same value. */
const GAP = 12;
const MARGIN = 8;

type Rect = { top: number; left: number; width: number; height: number };

// Peek results by key ("movie:12", "series:7"). Shared by every tile, so a poster hovered twice fetches once.
// A failed request, or an answer with nothing to show (a title just added may fill in later), is removed, so the next
// hover asks again.
const cache = new Map<string, Promise<Peek | null>>();

/** Keeps the fields a card reads, and checks their types. Anything else is treated as "nothing to show". */
function asPeek(value: unknown): Peek | null {
  if (typeof value !== "object" || value === null) return null;
  const { year, genres, overview } = value as Record<string, unknown>;
  if ((year !== null && typeof year !== "number") || !Array.isArray(genres) || typeof overview !== "string") return null;
  return { year: year as number | null, genres: genres.filter((genre): genre is string => typeof genre === "string"), overview };
}

/**
 * The hover-card facts for one title, from MediaHub's own peek route. Resolves null on any error or a non-200 answer,
 * and never throws. A 200 that says there is nothing to show also resolves null, and is not kept.
 */
export function loadPeek(kind: "movie" | "series", id: number): Promise<Peek | null> {
  const key = `${kind}:${id}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const url = kind === "movie" ? `/api/movies/${id}/peek` : `/api/tv/${id}/peek`;
  const request = (async (): Promise<Peek | null> => {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        cache.delete(key);
        return null;
      }
      const body: unknown = await res.json();
      const peek = asPeek((body as { peek?: unknown }).peek);
      if (peek === null) cache.delete(key);
      return peek;
    } catch {
      cache.delete(key);
      return null;
    }
  })();
  cache.set(key, request);
  return request;
}

type Hover = { el: HTMLElement; item: TilePeekItem | null };
type Open = { item: TilePeekItem; rect: Rect };

/**
 * Hover cards for a grid of poster tiles. The grid's handlers go on its <ul> and use event delegation, so the tiles
 * need no callbacks. A tile is found by its data-peek-key, and its poster box by data-peek-anchor. After the pointer has
 * rested on a tile for HOVER_DELAY_MS, the card opens beside the poster. The card doesn't take pointer events, so clicks
 * still reach the tile. Mouse only, and never while a button is held (a Focus drag). Moving off a tile, pressing, or
 * scrolling closes the card.
 */
export function useTilePeek(itemFor: (key: string) => TilePeekItem | undefined) {
  const [open, setOpen] = useState<Open | null>(null);
  const hover = useRef<Hover | null>(null);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    hover.current = null;
    setOpen(null);
  }, []);

  // Scrolling any element moves the poster away from the fixed card, so the capture listener closes it for all of them.
  useEffect(() => {
    window.addEventListener("scroll", stop, { capture: true, passive: true });
    return () => {
      window.removeEventListener("scroll", stop, { capture: true });
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [stop]);

  const onPointerOver: PointerEventHandler<HTMLUListElement> = (event) => {
    // Mouse only, and no button held: a press-and-drag on a Focus page never opens a card.
    if (event.pointerType !== "mouse" || event.buttons !== 0) return;
    const tile = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-peek-key]") : null;
    if (!tile || !event.currentTarget.contains(tile)) {
      // The hovered tile was removed (a filter, a search, a Focus remove), so no pointerout came. Close its card.
      if (hover.current && !hover.current.el.isConnected) stop();
      return;
    }
    // Moves inside the same tile bubble up here again. Only a new tile starts anything.
    if (hover.current?.el === tile) return;
    stop();

    const item = itemFor(tile.dataset.peekKey ?? "");
    // A tile with no poster has no card.
    if (!item || item.posterSrc === null) {
      hover.current = { el: tile, item: null };
      return;
    }
    hover.current = { el: tile, item };
    const openCard = () => {
      timer.current = null;
      // Measure when the card opens, not when the pointer arrived: the tile may have moved or been removed meanwhile.
      if (!tile.isConnected) return;
      const poster = tile.querySelector<HTMLElement>("[data-peek-anchor]");
      if (!poster) return;
      const box = poster.getBoundingClientRect();
      setOpen({ item, rect: { top: box.top, left: box.left, width: box.width, height: box.height } });
    };
    // Ask for the text once the pointer has rested briefly, so it is often ready by the time the card opens.
    timer.current = window.setTimeout(() => {
      void loadPeek(item.kind, item.id);
      timer.current = window.setTimeout(openCard, HOVER_DELAY_MS - PREFETCH_DELAY_MS);
    }, PREFETCH_DELAY_MS);
  };

  const onPointerOut: PointerEventHandler<HTMLUListElement> = (event) => {
    const current = hover.current;
    if (!current) return;
    // Moving between parts of the same tile is not leaving it.
    const next = event.relatedTarget;
    if (next instanceof Node && current.el.contains(next)) return;
    stop();
  };

  // Capture phase, so a press on a control that stops propagation (a Focus tile's ⋯ button) still closes the card.
  const onPointerDownCapture = () => stop();

  return {
    gridHandlers: { onPointerOver, onPointerOut, onPointerDownCapture },
    // A card whose title has left the grid (a filter or search change) is not drawn.
    card: open && itemFor(open.item.key) ? <TilePeekCard key={open.item.key} item={open.item} rect={open.rect} /> : null,
  };
}

/** The glow in the poster's own colours. A pale (black-and-white) poster gets half the strength. */
function glowStyle(hues: PosterHues): CSSProperties {
  const k = hues.pale ? 0.5 : 1;
  return {
    "--h1": String(hues.h1),
    "--h2": String(hues.h2),
    boxShadow: `0 0 0 1px oklch(0.7 0.15 var(--h1) / ${0.5 * k}), 0 18px 50px -10px oklch(0.6 0.2 var(--h1) / ${0.75 * k}), 0 0 60px -20px oklch(0.6 0.2 var(--h2) / ${0.6 * k})`,
  } as CSSProperties;
}

/**
 * The enlarged poster with its text panel beside it. The poster sits over the tile's poster box, scaled from its centre.
 * The panel goes on the right, or on the left when the right has no room. It is portalled to body, so no grid clips it.
 */
function TilePeekCard({ item, rect }: { item: TilePeekItem; rect: Rect }) {
  // undefined until the peek answers. Keyed to the item, so a card never shows another title's text.
  const [loaded, setLoaded] = useState<{ key: string; peek: Peek | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadPeek(item.kind, item.id).then((peek) => {
      if (!cancelled) setLoaded({ key: item.key, peek });
    });
    return () => {
      cancelled = true;
    };
  }, [item.key, item.kind, item.id]);
  const peek = loaded?.key === item.key ? loaded.peek : undefined;
  const hues = usePosterHues(item.posterSrc);

  if (item.posterSrc === null) return null;

  // The panel goes right when it fits, else left when that fits, else on the side with more room, kept on screen.
  const roomRight = window.innerWidth - MARGIN - (rect.left + rect.width + GAP);
  const roomLeft = rect.left - GAP - MARGIN;
  const side = roomRight >= PANEL_WIDTH || (roomLeft < PANEL_WIDTH && roomRight >= roomLeft) ? "right" : "left";
  const wanted = side === "right" ? rect.left + rect.width + GAP : rect.left - GAP - PANEL_WIDTH;
  const panelLeft = Math.max(MARGIN, Math.min(wanted, window.innerWidth - MARGIN - PANEL_WIDTH));
  const left = Math.min(rect.left, panelLeft);
  const right = Math.max(rect.left + rect.width, panelLeft + PANEL_WIDTH);

  const kindLabel = item.kind === "movie" ? "Movie" : "TV";
  const meta = peek
    ? [peek.year === null ? null : String(peek.year), kindLabel, peek.genres.join(", ")]
        .filter((part): part is string => part !== null && part !== "")
        .join(" · ")
    : kindLabel;

  return createPortal(
    <div
      aria-hidden
      style={{
        top: rect.top,
        left,
        width: right - left,
        height: rect.height,
        flexDirection: side === "right" ? "row" : "row-reverse",
        transformOrigin: side === "right" ? "left center" : "right center",
        ...(hues ? glowStyle(hues) : null),
      }}
      className={cn(
        "pointer-events-none fixed z-50 flex gap-3 animate-peek-in motion-reduce:animate-none",
        !hues && "shadow-2xl",
      )}
    >
      <div className="relative h-full shrink-0 transform-gpu" style={{ width: rect.width, transform: `scale(${POSTER_SCALE})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the sources are already small. The alt is empty because the title sits in the panel. */}
        <img
          src={item.posterSrc}
          alt=""
          className={cn("size-full rounded-md bg-muted object-cover", item.onDisk === false && "grayscale brightness-90")}
        />
      </div>
      <div
        className={cn(
          "flex min-w-0 shrink-0 flex-col overflow-hidden bg-popover p-3 text-popover-foreground",
          side === "right" ? "rounded-r-xl" : "rounded-l-xl",
        )}
        style={{ width: PANEL_WIDTH, height: rect.height }}
      >
        <p className="font-display text-base leading-tight font-bold line-clamp-2">{item.title}</p>
        {peek === undefined ? (
          <div className="mt-2 space-y-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{meta}</p>
            {peek !== null && peek.overview !== "" && (
              <p className="mt-2 text-[13px] leading-5 text-muted-foreground line-clamp-5">{peek.overview}</p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

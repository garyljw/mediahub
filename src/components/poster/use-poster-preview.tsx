"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { Peek } from "@/server/merge/peek";
import { PeekCard, PosterPreview } from "./poster";
import { PEEK_HEIGHT, PEEK_WIDTH, PREVIEW_HEIGHT, PREVIEW_WIDTH, previewPosition } from "./poster-preview";

/**
 * What a row's hover card shows: the title, whether it is a movie or a series, and its facts. A null peek gives the
 * poster-only preview instead.
 */
export type PeekInfo = { title: string; kind: "movie" | "series"; peek: Peek | null };

type Card = { title: string; kind: "movie" | "series"; peek: Peek };
type ActivePreview<K> = { key: K; src: string; top: number; left: number; card: Card | null };

/** How long the pointer rests on a row before its preview opens. */
const HOVER_DELAY_MS = 250;

/**
 * Hover preview for a list of poster rows. Rows call rowHandlers(key, src, info?) on their pointer events. After the
 * pointer has rested on a row for HOVER_DELAY_MS, the preview opens: a hover card (PeekCard) when the row has facts to
 * show, otherwise the row's thumbnail at full size. Both fade and grow in. The preview always opens to the left of
 * the thumbnail so it never covers the title, and falls back to the right only when the left has no room. Rows mark
 * their title cell with data-poster-anchor, which sets that fallback edge. Mouse only, and rows without a live
 * thumbnail get none.
 *
 * `side` picks the side. Left is the default, so tables never have the preview cover their title. Use `side: "right"`
 * for lists whose thumbnail is the first thing after a narrow action column (Add, Focus search): the preview then
 * opens just past the title cell (data-poster-anchor), and falls back to the left when the right has no room.
 *
 * `key` identifies the row. `activeKey` says which row's preview is showing, so a list can hide a preview whose row is
 * no longer visible. `preview` is the node to render (null when nothing shows). Render it where it can't be clipped;
 * it is portalled to body either way.
 */
export function usePosterPreview<K extends string | number>(options?: { side?: "left" | "right" }) {
  const [active, setActive] = useState<ActivePreview<K> | null>(null);
  // The preview waiting for its delay. Cleared on leave, on scroll, on clear() and on unmount.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Scrolling the page moves the thumbnail away from the fixed preview, so drop it, and any preview still waiting.
  // A container with its own scroll calls clear() from its onScroll.
  useEffect(() => {
    const clearOnScroll = () => {
      cancel();
      setActive(null);
    };
    window.addEventListener("scroll", clearOnScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", clearOnScroll);
      cancel();
    };
  }, [cancel]);

  function clear() {
    cancel();
    setActive(null);
  }

  function rowHandlers(key: K, src: string | null, info?: PeekInfo) {
    return {
      // Mouse only: a tap on a phone fires pointerenter with no matching leave, which would strand the preview.
      onPointerEnter(event: PointerEvent<HTMLElement>) {
        if (event.pointerType !== "mouse") return;
        // Close any card still open from another row, and any preview still waiting.
        clear();
        // Rows without a poster have no thumbnail, so they get no preview. A thumbnail that failed to load is not
        // rendered at all (the placeholder shows instead), so the query below finds nothing for it.
        const row = event.currentTarget;
        if (src === null || !row.querySelector("img[data-poster-thumb]")) return;
        const card: Card | null = info?.peek ? { title: info.title, kind: info.kind, peek: info.peek } : null;
        const size = card ? { width: PEEK_WIDTH, height: PEEK_HEIGHT } : { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT };
        timer.current = setTimeout(() => {
          timer.current = null;
          // Measure when the preview opens, not when the pointer arrived: the row may have moved or gone meanwhile
          // (a refresh, a filter, a container's own scroll). A row that left the page gets no preview.
          const thumb = row.querySelector<HTMLImageElement>("img[data-poster-thumb]");
          if (!row.isConnected || !thumb) return;
          // The preview always opens left of the thumbnail, so it never covers the title. When there is no room on
          // the left it falls back to the right, and the right edge used for that fallback is the row's title cell
          // (marked data-poster-anchor) when the row has one, otherwise the thumbnail itself. Vertically it stays
          // centred on the thumbnail.
          const thumbRect = thumb.getBoundingClientRect();
          const anchor = row.querySelector<HTMLElement>("[data-poster-anchor]");
          const rect = anchor
            ? { top: thumbRect.top, height: thumbRect.height, left: thumbRect.left, right: anchor.getBoundingClientRect().right }
            : thumbRect;
          const position = previewPosition(rect, { width: window.innerWidth, height: window.innerHeight }, options?.side ?? "left", size);
          setActive({ key, src, card, ...position });
        }, HOVER_DELAY_MS);
      },
      onPointerLeave() {
        clear();
      },
    };
  }

  let preview: ReactNode = null;
  if (active?.card) {
    preview = (
      <PeekCard
        src={active.src}
        title={active.card.title}
        peek={active.card.peek}
        kind={active.card.kind}
        top={active.top}
        left={active.left}
      />
    );
  } else if (active) {
    preview = <PosterPreview src={active.src} top={active.top} left={active.left} />;
  }

  return {
    rowHandlers,
    clear,
    activeKey: active?.key ?? null,
    preview,
  };
}

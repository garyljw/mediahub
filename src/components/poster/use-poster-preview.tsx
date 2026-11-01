"use client";

import { useEffect, useState, type PointerEvent } from "react";
import { PosterPreview } from "./poster";
import { previewPosition } from "./poster-preview";

type ActivePreview<K> = { key: K; src: string; top: number; left: number };

/**
 * Hover preview for a list of poster rows. Rows call rowHandlers(key, src) on their pointer events. The
 * preview shows the row's thumbnail at full size, so the browser serves it from cache. Mouse only, and
 * rows without a live thumbnail get none.
 *
 * `key` identifies the row. `activeKey` says which row's preview is showing, so a list can hide a preview
 * whose row is no longer visible. `preview` is the node to render (null when nothing shows). Render it
 * where it can't be clipped; it is portalled to body either way.
 */
export function usePosterPreview<K extends string | number>() {
  const [active, setActive] = useState<ActivePreview<K> | null>(null);

  // Scrolling the page moves the thumbnail away from the fixed preview, so drop it. A container with its
  // own scroll calls clear() from its onScroll.
  useEffect(() => {
    if (active === null) return;
    const clearOnScroll = () => setActive(null);
    window.addEventListener("scroll", clearOnScroll, { passive: true });
    return () => window.removeEventListener("scroll", clearOnScroll);
  }, [active]);

  function clear() {
    setActive(null);
  }

  function rowHandlers(key: K, src: string | null) {
    return {
      // Mouse only: a tap on a phone fires pointerenter with no matching leave, which would strand the preview.
      onPointerEnter(event: PointerEvent<HTMLElement>) {
        if (event.pointerType !== "mouse") return;
        // Rows without a poster have no thumbnail, so they get no preview. A thumbnail that failed to load
        // is not rendered at all (the placeholder shows instead), so the query below finds nothing for it.
        const thumb = event.currentTarget.querySelector<HTMLImageElement>("img[data-poster-thumb]");
        if (src === null || !thumb) {
          setActive(null);
          return;
        }
        // A row can mark a wider element (e.g. a title cell with a link) with data-poster-anchor, so the
        // preview opens beside it instead of covering the title. Vertically it stays centred on the thumbnail.
        const thumbRect = thumb.getBoundingClientRect();
        const anchor = event.currentTarget.querySelector<HTMLElement>("[data-poster-anchor]");
        const anchorRect = anchor?.getBoundingClientRect() ?? thumbRect;
        const rect = { top: thumbRect.top, height: thumbRect.height, left: anchorRect.left, right: anchorRect.right };
        const position = previewPosition(rect, {
          width: window.innerWidth,
          height: window.innerHeight,
        });
        setActive({ key, src, ...position });
      },
      onPointerLeave() {
        setActive(null);
      },
    };
  }

  return {
    rowHandlers,
    clear,
    activeKey: active?.key ?? null,
    preview: active ? <PosterPreview src={active.src} top={active.top} left={active.left} /> : null,
  };
}

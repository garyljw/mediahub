"use client";

import { useEffect, useState, type PointerEvent } from "react";
import { PosterPreview } from "./poster";
import { previewPosition } from "./poster-preview";

type ActivePreview<K> = { key: K; src: string; top: number; left: number };

/**
 * Hover preview for a list of poster rows. Rows call rowHandlers(key, src) on their pointer events. The
 * preview shows the row's thumbnail at full size, so the browser serves it from cache. It always opens to
 * the left of the thumbnail so it never covers the title, and falls back to the right only when the left
 * has no room. Rows mark their title cell with data-poster-anchor, which sets that fallback edge. Mouse
 * only, and rows without a live thumbnail get none.
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
        // The preview always opens left of the thumbnail, so it never covers the title. When there is no room
        // on the left it falls back to the right, and the right edge used for that fallback is the row's title
        // cell (marked data-poster-anchor) when the row has one, otherwise the thumbnail itself. Vertically it
        // stays centred on the thumbnail.
        const thumbRect = thumb.getBoundingClientRect();
        const anchor = event.currentTarget.querySelector<HTMLElement>("[data-poster-anchor]");
        const rect = anchor
          ? { top: thumbRect.top, height: thumbRect.height, left: thumbRect.left, right: anchor.getBoundingClientRect().right }
          : thumbRect;
        const position = previewPosition(rect, {
          width: window.innerWidth,
          height: window.innerHeight,
        }, "left");
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

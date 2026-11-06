"use client";

import { useEffect, useState } from "react";
import { pickPosterHues, type PosterHues } from "./poster-hues";

/**
 * The poster's two main hues, read in the browser from `src` (MediaHub's own poster route, so the canvas is never
 * tainted). The poster is drawn onto a small canvas and sampled. Null while it is read, and when there is no src, the
 * image fails, or the poster is black-and-white. The result is keyed to its src, so an old src's result never shows.
 */
export function usePosterHues(src: string | null): PosterHues | null {
  const [keyed, setKeyed] = useState<{ src: string; hues: PosterHues | null } | null>(null);

  useEffect(() => {
    if (src === null) return;
    let cancelled = false;

    (async () => {
      let hues: PosterHues | null = null;
      try {
        const img = new Image();
        img.decoding = "async";
        img.src = src;
        await img.decode();
        const canvas = document.createElement("canvas");
        // 48x72 keeps small accents (an eye, a logo) as more than a pixel or two.
        canvas.width = 48;
        canvas.height = 72;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, 48, 72);
          hues = pickPosterHues(ctx.getImageData(0, 0, 48, 72).data);
        }
      } catch {
        hues = null;
      }
      if (!cancelled) setKeyed({ src, hues });
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  return src !== null && keyed?.src === src ? keyed.hues : null;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Film } from "lucide-react";
import { cn } from "@/lib/utils";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "./poster-preview";

/**
 * Tracks whether a poster src has loaded or failed, for thumbnails, tiles, headshots and backdrops. Both states belong
 * to the src that set them: a new src starts again as neither, so the same <img> can load or recover. `loaded` drives the
 * fade-in over a skeleton slot, and `failed` swaps the image for its placeholder.
 */
export function usePosterImage(src: string | null) {
  // One settled state per src: a new src starts again as neither loaded nor failed.
  const [settled, setSettled] = useState<{ src: string; state: "loaded" | "failed" } | null>(null);
  const current = src !== null && settled?.src === src ? settled.state : null;
  const failed = current === "failed";
  const loaded = current === "loaded";
  const imgRef = useRef<HTMLImageElement>(null);

  // An image can finish or fail before React hydrates, and then onLoad or onError never fires. Check after each src change.
  useEffect(() => {
    const img = imgRef.current;
    if (img && src !== null && img.complete) setSettled({ src, state: img.naturalWidth > 0 ? "loaded" : "failed" });
  }, [src]);

  return {
    failed,
    loaded,
    imgRef,
    onLoad: () => {
      if (src !== null) setSettled({ src, state: "loaded" });
    },
    onError: () => {
      if (src !== null) setSettled({ src, state: "failed" });
    },
  };
}

/**
 * A 24x36 poster thumbnail, or a same-size placeholder when there is no src or it failed to load. While it loads, the
 * thumbnail sits over a skeleton of the same size. `src` is always one of MediaHub's own poster routes, never a Radarr or
 * TMDB URL.
 */
export function Poster({ src }: { src: string | null }) {
  const { failed, loaded, imgRef, onLoad, onError } = usePosterImage(src);

  if (src !== null && !failed) {
    return (
      <div className={cn("relative h-9 w-6 shrink-0 rounded-sm", !loaded && "skeleton")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the sources are already small (Radarr 250px, TMDB w342). The alt is empty because the title sits right next to it. */}
        <img
          ref={imgRef}
          data-poster-thumb
          src={src}
          alt=""
          width={24}
          height={36}
          loading="lazy"
          decoding="async"
          onLoad={onLoad}
          onError={onError}
          className={cn(
            "absolute inset-0 size-full rounded-sm bg-muted object-cover transition-opacity duration-300 motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    );
  }

  return (
    <div aria-hidden className="flex h-9 w-6 shrink-0 items-center justify-center rounded-sm bg-muted">
      <Film className="size-3 text-muted-foreground/60" />
    </div>
  );
}

/**
 * A full-width poster for a grid tile (the Home page). It fills its container at 2:3, and shows a Film
 * placeholder when there is no src or it failed to load. While it loads, it sits over a skeleton of the same size.
 * `previewThumb` marks the image as a thumbnail for usePosterPreview, for lists that show tiles at thumbnail size
 * (the season cards).
 */
export function PosterTile({ src, previewThumb = false }: { src: string | null; previewThumb?: boolean }) {
  const { failed, loaded, imgRef, onLoad, onError } = usePosterImage(src);

  if (src !== null && !failed) {
    return (
      <div className={cn("relative aspect-[2/3] w-full rounded-md", !loaded && "skeleton")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the sources are already small (Radarr 250px, TMDB w342). The alt is empty because the title sits right next to it. */}
        <img
          ref={imgRef}
          data-poster-thumb={previewThumb || undefined}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={onLoad}
          onError={onError}
          className={cn(
            "absolute inset-0 size-full rounded-md bg-muted object-cover transition-opacity duration-300 motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    );
  }

  return (
    <div aria-hidden className="flex aspect-[2/3] w-full items-center justify-center rounded-md bg-muted">
      <Film className="size-8 text-muted-foreground/60" />
    </div>
  );
}

/**
 * A larger copy of a poster, shown beside a hovered row. `src` is the thumbnail's own URL, so the browser
 * serves it from cache. It is portalled to body so a list's overflow clipping can't cut it off.
 */
export function PosterPreview({ src, top, left }: { src: string; top: number; left: number }) {
  return createPortal(
    // eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the sources are already small (Radarr 250px, TMDB w342). The alt is empty because the title sits right next to it.
    <img
      src={src}
      alt=""
      aria-hidden
      width={PREVIEW_WIDTH}
      height={PREVIEW_HEIGHT}
      style={{ top, left }}
      className="pointer-events-none fixed z-50 h-60 w-40 rounded-md border bg-muted object-cover shadow-lg"
    />,
    document.body,
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Film } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Peek } from "@/server/merge/peek";
import { PEEK_HEIGHT, PEEK_WIDTH, PREVIEW_HEIGHT, PREVIEW_WIDTH } from "./poster-preview";

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
 * A poster thumbnail, 24x36 (`sm`, for tables with a hover preview) or 64x96 (`lg`, for the Add and Focus search
 * rows, which need no preview), or a same-size placeholder when there is no src or it failed to load. While it loads,
 * the thumbnail sits over a skeleton of the same size. `src` is always one of MediaHub's own poster routes, never a Radarr or
 * TMDB URL.
 */
export function Poster({ src, size = "sm" }: { src: string | null; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "h-24 w-16 rounded" : "h-9 w-6 rounded-sm";
  const { failed, loaded, imgRef, onLoad, onError } = usePosterImage(src);

  if (src !== null && !failed) {
    return (
      <div className={cn("relative shrink-0", box, !loaded && "skeleton")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the sources are already small (Radarr 250px, TMDB w342). The alt is empty because the title sits right next to it. */}
        <img
          ref={imgRef}
          data-poster-thumb
          src={src}
          alt=""
          width={size === "lg" ? 64 : 24}
          height={size === "lg" ? 96 : 36}
          loading="lazy"
          decoding="async"
          onLoad={onLoad}
          onError={onError}
          className={cn(
            "absolute inset-0 size-full rounded-[inherit] bg-muted object-cover transition-opacity duration-300 motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    );
  }

  return (
    <div aria-hidden className={cn("flex shrink-0 items-center justify-center bg-muted", box)}>
      <Film className={cn("text-muted-foreground/60", size === "lg" ? "size-5" : "size-3")} />
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
      className="pointer-events-none fixed z-50 h-60 w-40 animate-peek-in rounded-md border bg-muted object-cover shadow-lg motion-reduce:animate-none"
    />,
    document.body,
  );
}

/**
 * The hover card for a title row: its poster beside the title, the year, kind and genres, and the overview. Fixed size
 * (PEEK_WIDTH x PEEK_HEIGHT), portalled to body like PosterPreview. `src` is the row's own thumbnail URL, so the browser
 * serves it from cache. It is aria-hidden, as the poster-only preview is: the same facts are on the row and the item page.
 */
export function PeekCard({
  src,
  title,
  peek,
  kind,
  top,
  left,
}: {
  src: string;
  title: string;
  peek: Peek;
  kind: "movie" | "series";
  top: number;
  left: number;
}) {
  const meta = [peek.year === null ? null : String(peek.year), kind === "movie" ? "Movie" : "TV", peek.genres.join(", ")]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
  return createPortal(
    <div
      aria-hidden
      // The size comes from the same constants the positioning uses, so the two can't drift apart.
      style={{ top, left, width: PEEK_WIDTH, height: PEEK_HEIGHT }}
      className="pointer-events-none fixed z-50 grid animate-peek-in grid-cols-[120px_1fr] gap-3.5 overflow-hidden rounded-xl bg-popover p-3 text-[13px] leading-5 text-popover-foreground shadow-2xl ring-1 ring-border motion-reduce:animate-none"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the sources are already small (Radarr 250px, TMDB w342). The alt is empty because the title sits right next to it. */}
      <img src={src} alt="" width={120} height={180} className="h-[180px] w-[120px] rounded-lg bg-muted object-cover" />
      <div className="min-w-0 overflow-hidden">
        <p className="font-display text-base leading-tight font-bold line-clamp-2">{title}</p>
        {meta !== "" && <p className="mt-1 text-muted-foreground line-clamp-2">{meta}</p>}
        {peek.overview !== "" && <p className="mt-2 text-muted-foreground line-clamp-4">{peek.overview}</p>}
      </div>
    </div>,
    document.body,
  );
}

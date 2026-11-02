"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Film } from "lucide-react";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "./poster-preview";

/**
 * Tracks whether a poster src failed to load, for both thumbnails and tiles. A failure belongs to the src that
 * failed: a new src gets a fresh attempt, so the same <img> can recover.
 */
function usePosterFailure(src: string | null) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src !== null && failedSrc === src;
  const imgRef = useRef<HTMLImageElement>(null);

  // An image can fail before React hydrates, and then onError never fires. Check after each src change.
  useEffect(() => {
    const img = imgRef.current;
    if (img && src !== null && img.complete && img.naturalWidth === 0) setFailedSrc(src);
  }, [src]);

  return { failed, imgRef, markFailed: () => setFailedSrc(src) };
}

/**
 * A 24x36 poster thumbnail, or a same-size placeholder when there is no src or it failed to load.
 * `src` is always one of MediaHub's own poster routes, never a Radarr or TMDB URL.
 */
export function Poster({ src }: { src: string | null }) {
  const { failed, imgRef, markFailed } = usePosterFailure(src);

  if (src !== null && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the sources are already small (Radarr 250px, TMDB w342). The alt is empty because the title sits right next to it.
      <img
        ref={imgRef}
        data-poster-thumb
        src={src}
        alt=""
        width={24}
        height={36}
        loading="lazy"
        decoding="async"
        onError={markFailed}
        className="h-9 w-6 shrink-0 rounded-sm bg-muted object-cover"
      />
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
 * placeholder when there is no src or it failed to load.
 */
export function PosterTile({ src }: { src: string | null }) {
  const { failed, imgRef, markFailed } = usePosterFailure(src);

  if (src !== null && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the sources are already small (Radarr 250px, TMDB w342). The alt is empty because the title sits right next to it.
      <img
        ref={imgRef}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={markFailed}
        className="aspect-[2/3] w-full rounded-md object-cover bg-muted"
      />
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
 * serves it from cache. It is portalled to body so the table's overflow clipping can't cut it off.
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

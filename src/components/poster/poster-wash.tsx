"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { usePosterHues } from "./use-poster-hues";

/** The look shared by every wash layer: the poster-wash gradients, at the strength PosterWash sets, faded in. */
const LAYER = "pointer-events-none poster-wash opacity-[var(--wash-opacity,0)] transition-opacity duration-700 motion-reduce:transition-none";

/**
 * Washes the top of a movie or series page with the poster's own two main colours. The glow fills the content area
 * above and around the children. It fades in once the hues are known. A black-and-white poster gets a paler wash in
 * electric blue. With no hues (no poster, or a failed image) it stays invisible, and the page looks as it did before.
 *
 * The wrapper sets --h1, --h2 and --wash-opacity, so children can draw more of the wash with PosterWashLayer, and
 * `data-washed` marks that a wash is showing.
 */
export function PosterWash({
  posterSrc,
  className,
  children,
}: {
  posterSrc: string | null;
  className?: string;
  children: ReactNode;
}) {
  const hues = usePosterHues(posterSrc);

  return (
    <div
      className={cn("relative isolate", className)}
      data-washed={hues ? "" : undefined}
      style={
        hues
          ? ({ "--h1": hues.h1, "--h2": hues.h2, "--wash-opacity": hues.pale ? 0.55 : 1 } as CSSProperties)
          : undefined
      }
    >
      {/* The layer reaches the padding of <main> (px-4 py-6, md:px-8), so the glow runs to the edges of the content area. */}
      <div aria-hidden className={cn(LAYER, "absolute -z-10 -top-6 -inset-x-4 h-[40rem] md:-inset-x-8")} />
      {children}
    </div>
  );
}

/**
 * More of the wash, filling its positioned parent, e.g. inside the header card over the backdrop and behind the text.
 * Invisible outside a PosterWash or before its hues are known. Server-safe: it only reads the CSS variables.
 */
export function PosterWashLayer() {
  return <div aria-hidden className={cn(LAYER, "absolute inset-0")} />;
}

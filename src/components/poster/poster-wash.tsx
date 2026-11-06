"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { usePosterHues } from "./use-poster-hues";

/**
 * Washes the top of a movie or series page with the poster's own two main colours. The glow fills the content area
 * above and around the children. It fades in once the hues are known. A black-and-white poster gets a
 * paler wash in electric blue. With no hues (no poster, or a failed image) it stays invisible, and the page looks as
 * it did before. The hues go on the wrapper as
 * --h1 and --h2, so children can use them too, and `data-washed` marks that a wash is showing.
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
      style={hues ? ({ "--h1": hues.h1, "--h2": hues.h2 } as CSSProperties) : undefined}
    >
      {/* The layer reaches the padding of <main> (px-4 py-6, md:px-8), so the glow runs to the edges of the content area. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -z-10 -top-6 -inset-x-4 h-[40rem] md:-inset-x-8 poster-wash transition-opacity duration-700 motion-reduce:transition-none",
          hues === null ? "opacity-0" : hues.pale ? "opacity-55" : "opacity-100",
        )}
      />
      {children}
    </div>
  );
}

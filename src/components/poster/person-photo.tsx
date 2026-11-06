"use client";

import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePosterImage } from "./poster";

/**
 * A cast headshot at 2:3, or a placeholder when there is no src or it failed to load. While it loads, it sits over a
 * skeleton of the same size. `src` is always one of MediaHub's own headshot routes, never a TMDB URL.
 */
export function PersonPhoto({ src }: { src: string | null }) {
  const { failed, loaded, imgRef, onLoad, onError } = usePosterImage(src);

  if (src !== null && !failed) {
    return (
      <div className={cn("relative aspect-[2/3] w-full rounded-md", !loaded && "skeleton")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the headshots are already small (TMDB w185). The alt is empty because the name is right beside it. */}
        <img
          ref={imgRef}
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
      <User className="size-8 text-muted-foreground/60" />
    </div>
  );
}

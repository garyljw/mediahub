"use client";

import { User } from "lucide-react";
import { usePosterFailure } from "./poster";

/**
 * A cast headshot at 2:3, or a placeholder when there is no src or it failed to load. `src` is always one of
 * MediaHub's own headshot routes, never a TMDB URL.
 */
export function PersonPhoto({ src }: { src: string | null }) {
  const { failed, imgRef, markFailed } = usePosterFailure(src);

  if (src !== null && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the headshots are already small (TMDB w185). The alt is empty because the name is right beside it.
      <img
        ref={imgRef}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={markFailed}
        className="aspect-[2/3] w-full rounded-md bg-muted object-cover"
      />
    );
  }

  return (
    <div aria-hidden className="flex aspect-[2/3] w-full items-center justify-center rounded-md bg-muted">
      <User className="size-8 text-muted-foreground/60" />
    </div>
  );
}

"use client";

import { usePosterFailure } from "./poster";

/**
 * A movie's backdrop behind its page header, faded with a gradient so the text stays readable in light and dark
 * themes. `src` is MediaHub's own backdrop route. It renders nothing when the image fails to load, so the header keeps
 * its card background.
 */
export function Backdrop({ src }: { src: string }) {
  const { failed, imgRef, markFailed } = usePosterFailure(src);

  if (failed) return null;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the backdrop is already a single fixed file. The alt is empty because the title is the heading beside it. */}
      <img
        ref={imgRef}
        src={src}
        alt=""
        decoding="async"
        onError={markFailed}
        className="absolute inset-0 size-full object-cover opacity-40"
      />
      <div aria-hidden className="absolute inset-0 bg-linear-to-t from-background via-background/80 to-background/30" />
    </>
  );
}

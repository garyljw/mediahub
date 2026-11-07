"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_FOCUS, focusFromCrop, objectPosition, readFocus, writeFocus, type Focus } from "./backdrop-focus";
import { usePosterImage } from "./poster";

type Size = { width: number; height: number };
const NO_SIZE: Size = { width: 0, height: 0 };

/**
 * A movie's or series' backdrop behind its page header, faded with a gradient so the text stays readable in light and dark
 * themes. `src` is MediaHub's own backdrop route. It renders nothing when the image fails to load, so the header keeps
 * its card background. While it loads, a skeleton fills the header, and the image fades in over it.
 *
 * The image is cropped to its interesting part (faces, edges, colour) with object-position. The focus is found once per
 * backdrop, in the browser, when the image has loaded and the browser is idle: the smartcrop library picks a crop, and the
 * centre of that crop is stored in this browser's localStorage, so later visits skip the search. Until a focus is known,
 * the image starts 25% of the way down, where faces usually sit. The position is recalculated as the header resizes, and
 * a newly found focus slides into place.
 */
export function Backdrop({ src }: { src: string }) {
  const { failed, loaded, imgRef, onLoad, onError } = usePosterImage(src);
  // Each piece of state is kept with the src it belongs to, so a new src starts from its own cache or the default.
  // `fresh` is true for a focus just found by smartcrop: only that change slides. A cached focus and a resize apply at
  // once, so a remembered backdrop doesn't slide on every visit and the crop doesn't lag behind a window being resized.
  const [known, setKnown] = useState<{ src: string; focus: Focus; fresh: boolean } | null>(null);
  const [layout, setLayout] = useState<{ src: string; image: Size; box: Size } | null>(null);

  // Read this browser's cached focus after mount, so the server and first browser render both start at the default.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = readFocus(src);
      if (cached && !cancelled) setKnown({ src, focus: cached, fresh: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Keep the position right as the header resizes. The natural size is known once the image has loaded.
  useEffect(() => {
    const img = imgRef.current;
    if (!img || failed) return;
    const measure = () => {
      if (img.naturalWidth <= 0) return;
      const image = { width: img.naturalWidth, height: img.naturalHeight };
      const box = { width: img.clientWidth, height: img.clientHeight };
      // Skip the re-render when nothing changed, which the observer reports often.
      setLayout((prev) =>
        prev !== null &&
        prev.src === src &&
        prev.image.width === image.width &&
        prev.image.height === image.height &&
        prev.box.width === box.width &&
        prev.box.height === box.height
          ? prev
          : { src, image, box },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(img);
    return () => observer.disconnect();
  }, [src, failed, loaded, imgRef]);

  // Find a focus for a backdrop with no cached one, once it has loaded and the browser is idle.
  useEffect(() => {
    if (!loaded || failed || readFocus(src) !== null) return;
    let cancelled = false;
    let idleId: number | undefined;
    let timerId: number | undefined;

    const run = async () => {
      const img = imgRef.current;
      if (!img || img.clientWidth === 0 || img.clientHeight === 0) return;
      try {
        const mod = await import("smartcrop");
        const smartcrop = mod.default;
        const result = await smartcrop.crop(img, {
          width: img.clientWidth,
          height: img.clientHeight,
          minScale: 1,
        });
        const focus = focusFromCrop(result.topCrop, { width: img.naturalWidth, height: img.naturalHeight });
        if (cancelled || !focus) return;
        writeFocus(src, focus);
        setKnown({ src, focus, fresh: true });
      } catch {
        // The focus stays where it is. A failed search is not worth a console message.
      }
    };

    if (typeof window.requestIdleCallback === "function") idleId = window.requestIdleCallback(() => void run());
    else timerId = window.setTimeout(() => void run(), 0);

    return () => {
      cancelled = true;
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [src, loaded, failed, imgRef]);

  if (failed) return null;

  const own = known?.src === src ? known : null;
  const focus = own?.focus ?? DEFAULT_FOCUS;
  // Without a measured layout (server render, first render, before load) zero sizes give the default position.
  const current = layout?.src === src ? layout : null;
  const position = objectPosition(focus, current?.image ?? NO_SIZE, current?.box ?? NO_SIZE);

  return (
    <>
      {!loaded && (
        <div aria-hidden className="absolute inset-0">
          <div className="skeleton size-full" />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the backdrop is already a single fixed file. The alt is empty because the title is the heading beside it. */}
      <img
        ref={imgRef}
        src={src}
        alt=""
        decoding="async"
        onLoad={onLoad}
        onError={onError}
        style={{ objectPosition: position }}
        className={cn(
          "absolute inset-0 size-full object-cover duration-300 motion-reduce:transition-none",
          own?.fresh ? "transition-[opacity,object-position]" : "transition-opacity",
          loaded ? "opacity-35" : "opacity-0",
        )}
      />
      <div aria-hidden className="absolute inset-0 bg-linear-to-t from-background via-background/70 to-background/20" />
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Film } from "lucide-react";

/**
 * A 24x36 poster thumbnail, or a same-size placeholder when there is no poster or it failed to load.
 * The poster comes from MediaHub's own route, never from Radarr or TMDB directly.
 */
export function MoviePoster({ movieId, hasPoster }: { movieId: number; hasPoster: boolean }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // An image can fail before React hydrates, and then onError never fires. Check once on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (hasPoster && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- next/image's optimizer would load sharp on the 2 GB NAS, and the source is already a 250px thumbnail. The alt is empty because the title sits right next to it.
      <img
        ref={imgRef}
        src={`/api/movies/${movieId}/poster`}
        alt=""
        width={24}
        height={36}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
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

"use client";

import type { ReactNode } from "react";
import { PosterTile } from "@/components/poster/poster";
import { usePosterPreview } from "@/components/poster/use-poster-preview";

/**
 * A season card's poster thumbnail with the hover preview, beside `children` (the season's title block). Each card
 * has its own preview, as the cards are server-rendered. The title block marks its label with data-poster-anchor, so a
 * preview that can't open on the left opens past the label instead of over it. `src` is MediaHub's TVDB poster route,
 * or null for the placeholder.
 */
export function SeasonPoster({ src, children }: { src: string | null; children: ReactNode }) {
  const posterPreview = usePosterPreview<number>();

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4" {...posterPreview.rowHandlers(0, src)}>
      <div className="w-16 shrink-0 rounded-md shadow-lg sm:w-20">
        <PosterTile src={src} previewThumb />
      </div>
      {children}
      {posterPreview.preview}
    </div>
  );
}

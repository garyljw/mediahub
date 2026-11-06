/** The poster-only preview: the thumbnail's own poster, shown larger. */
export const PREVIEW_WIDTH = 160;
export const PREVIEW_HEIGHT = 240;
/** The hover card: a poster beside the title's facts. Fixed size, 12px padding around a 180px-tall poster. */
export const PEEK_WIDTH = 320;
export const PEEK_HEIGHT = 204;
const GAP = 8;
const MARGIN = 8;

export type Rect = { top: number; left: number; right: number; height: number };
export type PreviewSize = { width: number; height: number };

const POSTER_SIZE: PreviewSize = { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT };

/**
 * Where the fixed-position preview goes: beside the thumbnail, vertically centred on it, kept inside the viewport.
 * By default it opens on the left and flips right when there is no room. With side "right" it opens on the right
 * and flips left when there is no room. `size` is the preview's size (the poster-only preview by default).
 */
export function previewPosition(
  thumb: Rect,
  viewport: { width: number; height: number },
  side: "right" | "left" = "left",
  size: PreviewSize = POSTER_SIZE,
): { top: number; left: number } {
  const rightOf = thumb.right + GAP;
  const leftOf = thumb.left - GAP - size.width;
  let left: number;
  if (side === "left") {
    left = leftOf >= MARGIN ? leftOf : rightOf;
  } else {
    left = rightOf + size.width > viewport.width - MARGIN ? leftOf : rightOf;
  }
  // Keep it on screen whichever side was picked. On a viewport narrower than the preview, the left margin wins.
  left = Math.max(Math.min(left, viewport.width - MARGIN - size.width), MARGIN);

  // On a viewport shorter than the preview, pin to the top margin rather than clamp backwards.
  const centred = thumb.top + thumb.height / 2 - size.height / 2;
  const maxTop = viewport.height - MARGIN - size.height;
  const top = maxTop < MARGIN ? MARGIN : Math.min(Math.max(centred, MARGIN), maxTop);

  return { top, left };
}

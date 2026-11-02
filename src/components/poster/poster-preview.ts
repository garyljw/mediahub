export const PREVIEW_WIDTH = 160;
export const PREVIEW_HEIGHT = 240;
const GAP = 8;
const MARGIN = 8;

export type Rect = { top: number; left: number; right: number; height: number };

/**
 * Where the fixed-position preview goes: beside the thumbnail, vertically centred on it, kept inside the viewport.
 * By default it opens on the left and flips right when there is no room. With side "right" it opens on the right
 * and flips left when there is no room.
 */
export function previewPosition(
  thumb: Rect,
  viewport: { width: number; height: number },
  side: "right" | "left" = "left",
): { top: number; left: number } {
  const rightOf = thumb.right + GAP;
  const leftOf = thumb.left - GAP - PREVIEW_WIDTH;
  let left: number;
  if (side === "left") {
    left = leftOf >= MARGIN ? leftOf : rightOf;
  } else {
    left = rightOf + PREVIEW_WIDTH > viewport.width - MARGIN ? leftOf : rightOf;
  }
  // Keep it on screen whichever side was picked. On a viewport narrower than the preview, the left margin wins.
  left = Math.max(Math.min(left, viewport.width - MARGIN - PREVIEW_WIDTH), MARGIN);

  // On a viewport shorter than the preview, pin to the top margin rather than clamp backwards.
  const centred = thumb.top + thumb.height / 2 - PREVIEW_HEIGHT / 2;
  const maxTop = viewport.height - MARGIN - PREVIEW_HEIGHT;
  const top = maxTop < MARGIN ? MARGIN : Math.min(Math.max(centred, MARGIN), maxTop);

  return { top, left };
}

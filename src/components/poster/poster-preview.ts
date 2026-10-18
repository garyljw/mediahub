export const PREVIEW_WIDTH = 160;
export const PREVIEW_HEIGHT = 240;
const GAP = 8;
const MARGIN = 8;

export type Rect = { top: number; left: number; right: number; height: number };

/** Where the fixed-position preview goes: right of the thumbnail, vertically centred on it, kept inside the viewport. */
export function previewPosition(
  thumb: Rect,
  viewport: { width: number; height: number },
): { top: number; left: number } {
  // Flip to the left of the thumbnail when the right side has no room.
  let left = thumb.right + GAP;
  if (left + PREVIEW_WIDTH > viewport.width - MARGIN) left = thumb.left - GAP - PREVIEW_WIDTH;
  left = Math.max(left, MARGIN);

  // On a viewport shorter than the preview, pin to the top margin rather than clamp backwards.
  const centred = thumb.top + thumb.height / 2 - PREVIEW_HEIGHT / 2;
  const maxTop = viewport.height - MARGIN - PREVIEW_HEIGHT;
  const top = maxTop < MARGIN ? MARGIN : Math.min(Math.max(centred, MARGIN), maxTop);

  return { top, left };
}

/**
 * Where a backdrop's interesting part sits, as fractions (0..1) of the image's width and height. The backdrop uses it to
 * choose `object-position`, so a wide header shows the faces instead of the middle of the picture.
 */
export type Focus = { x: number; y: number };

/** Used until a focus is known. Faces in backdrops usually sit in the upper part, so start a quarter of the way down. */
export const DEFAULT_FOCUS: Focus = { x: 0.5, y: 0.25 };

const DEFAULT_POSITION = "50% 25%";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The centre of a crop as fractions of the image, or null when the sizes are not usable. */
export function focusFromCrop(
  crop: { x: number; y: number; width: number; height: number },
  image: { width: number; height: number },
): Focus | null {
  const values = [crop.x, crop.y, crop.width, crop.height, image.width, image.height];
  if (!values.every(isFiniteNumber)) return null;
  if (image.width <= 0 || image.height <= 0) return null;
  return {
    x: clamp01((crop.x + crop.width / 2) / image.width),
    y: clamp01((crop.y + crop.height / 2) / image.height),
  };
}

/**
 * One axis of `object-position` for `object-fit: cover`. `scale` is the cover scale shared by both axes. `visible` is
 * the fraction of the image this axis shows, and the position slides the visible window so the focus sits as near the
 * middle as the image allows.
 */
function axisPercent(focus: number, imageSize: number, boxSize: number, scale: number): number {
  const visible = Math.min(1, boxSize / scale / imageSize);
  if (visible >= 1) return 50;
  const start = Math.min(Math.max(focus - visible / 2, 0), 1 - visible);
  return (start / (1 - visible)) * 100;
}

/** The CSS `object-position` that keeps `focus` as close to the middle of `box` as `object-fit: cover` allows. */
export function objectPosition(focus: Focus, image: { width: number; height: number }, box: { width: number; height: number }): string {
  const values = [focus.x, focus.y, image.width, image.height, box.width, box.height];
  if (!values.every(isFiniteNumber)) return DEFAULT_POSITION;
  if (image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0) return DEFAULT_POSITION;
  const scale = Math.max(box.width / image.width, box.height / image.height);
  const x = axisPercent(focus.x, image.width, box.width, scale);
  const y = axisPercent(focus.y, image.height, box.height, scale);
  return `${Math.round(x * 10) / 10}% ${Math.round(y * 10) / 10}%`;
}

const KEY_PREFIX = "mediahub:backdrop-focus:";

/** The focus remembered for this backdrop in this browser, or null when there is none or it is not usable. */
export function readFocus(src: string): Focus | null {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${src}`);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { x, y } = parsed as { x?: unknown; y?: unknown };
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  } catch {
    // Storage can throw (private mode, blocked site data) or hold junk.
    return null;
  }
}

/** Remembers `focus` for this backdrop in this browser. Storage errors are ignored. */
export function writeFocus(src: string, focus: Focus): void {
  try {
    const rounded = { x: Math.round(focus.x * 1000) / 1000, y: Math.round(focus.y * 1000) / 1000 };
    localStorage.setItem(`${KEY_PREFIX}${src}`, JSON.stringify(rounded));
  } catch {
    // Storage can be full, blocked or missing. The focus just is not remembered.
  }
}

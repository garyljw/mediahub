// Picks the two main hues of a poster for the page wash. Pure functions only: the browser side (drawing the poster
// onto a small canvas) lives in use-poster-hues.ts, so this file can be tested with plain pixel arrays.

/** `pale` marks the stand-in wash for a black-and-white poster, which the page shows at lower strength. */
export type PosterHues = { h1: number; h2: number; pale?: boolean };

/** The wash for a black-and-white or muted poster: a pale electric blue, like a softer version of a blue-toned poster. */
export const MONOCHROME_HUES: PosterHues = { h1: 245, h2: 265, pale: true };

const ALPHA_MIN = 128;
const CHROMA_MIN = 0.04;
const L_MIN = 0.2;
const L_MAX = 0.92;
/** A poster needs at least this share of colourful pixels, or it gets no wash (black-and-white or muted). */
const COLOURFUL_SHARE_MIN = 0.08;
/**
 * Or this share of vivid pixels: a mostly grey poster with one strong accent (a blue eye, a red logo) still gets a wash
 * in the accent's colour.
 */
const VIVID_CHROMA_MIN = 0.06;
const VIVID_SHARE_MIN = 0.01;
const BINS = 24;
const BIN_DEGREES = 360 / BINS;
/** The second hue must sit at least this far (circular distance) from the first. */
const SECOND_HUE_MIN_SEPARATION = 45;

/** The shortest distance between two hues in degrees, 0 to 180. */
export function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/**
 * sRGB (0 to 255) to OKLCH, using Björn Ottosson's OKLab matrices. Returns lightness (0 to 1), chroma, and hue in
 * degrees (0 to 360).
 */
function srgbToOklch(r8: number, g8: number, b8: number): { l: number; c: number; h: number } {
  const r = srgbToLinear(r8 / 255);
  const g = srgbToLinear(g8 / 255);
  const b = srgbToLinear(b8 / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

/** The circular (vector) mean of hues, each weighted, in degrees 0 to 360. */
function circularMean(samples: { h: number; w: number }[]): number {
  let x = 0;
  let y = 0;
  for (const { h, w } of samples) {
    const rad = (h * Math.PI) / 180;
    x += w * Math.cos(rad);
    y += w * Math.sin(rad);
  }
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Two main hues from RGBA pixel bytes (as from getImageData). Only pixels with alpha of at least 128 count. A pixel is
 * colourful when its chroma is at least 0.04 and its lightness is between 0.2 and 0.92. Colourful pixels go into 24
 * hue bins of 15 degrees, weighted by chroma. h1 is the mean hue of the heaviest bin. h2 is the mean hue of the
 * heaviest bin at least 45 degrees away from h1, or h1 + 40 when no bin qualifies. Returns null when fewer than 8% of
 * the opaque pixels are colourful and fewer than 1% are vivid (chroma of at least 0.06).
 */
export function pickPosterHues(data: Uint8ClampedArray): PosterHues | null {
  let opaque = 0;
  let vivid = 0;
  const colourful: { h: number; w: number; bin: number }[] = [];

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < ALPHA_MIN) continue;
    opaque++;
    const { l, c, h } = srgbToOklch(data[i], data[i + 1], data[i + 2]);
    if (c >= CHROMA_MIN && l >= L_MIN && l <= L_MAX) {
      colourful.push({ h, w: c, bin: Math.floor(h / BIN_DEGREES) % BINS });
      if (c >= VIVID_CHROMA_MIN) vivid++;
    }
  }

  if (opaque === 0) return null;
  if (colourful.length < COLOURFUL_SHARE_MIN * opaque && vivid < VIVID_SHARE_MIN * opaque) return null;

  const weights = new Array<number>(BINS).fill(0);
  for (const p of colourful) weights[p.bin] += p.w;

  // Heaviest bin first. On a tie the lower bin wins, so the result is stable.
  const heaviest = (exclude: (bin: number) => boolean): number => {
    let best = -1;
    for (let bin = 0; bin < BINS; bin++) {
      if (weights[bin] <= 0 || exclude(bin)) continue;
      if (best === -1 || weights[bin] > weights[best]) best = bin;
    }
    return best;
  };

  const firstBin = heaviest(() => false);
  if (firstBin === -1) return null;
  const h1 = Math.round(circularMean(colourful.filter((p) => p.bin === firstBin))) % 360;

  const secondBin = heaviest(
    (bin) => circularDistance(bin * BIN_DEGREES + BIN_DEGREES / 2, h1) < SECOND_HUE_MIN_SEPARATION,
  );
  const h2 =
    secondBin === -1
      ? (h1 + 40) % 360
      : Math.round(circularMean(colourful.filter((p) => p.bin === secondBin))) % 360;

  return { h1, h2 };
}

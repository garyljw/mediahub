import { describe, expect, it } from "vitest";
import { circularDistance, pickPosterHues } from "./poster-hues";

/** RGBA bytes for a list of [r, g, b, a] pixels. */
function pixels(...px: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(px.flat());
}

/** `count` copies of one pixel. */
function solid(count: number, r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  return pixels(...Array.from({ length: count }, () => [r, g, b, a] as [number, number, number, number]));
}

/** `count` copies of one pixel followed by `count2` copies of another. */
function two(count1: number, p1: number[], count2: number, p2: number[]): Uint8ClampedArray {
  const out: number[] = [];
  for (let i = 0; i < count1; i++) out.push(...p1);
  for (let i = 0; i < count2; i++) out.push(...p2);
  return new Uint8ClampedArray(out);
}

// OKLCH hue of pure sRGB red is about 29 degrees, and of pure blue about 264.
const RED_HUE = 29;
const BLUE_HUE = 264;

describe("circularDistance", () => {
  it("measures the short way round the circle", () => {
    expect(circularDistance(10, 350)).toBe(20);
    expect(circularDistance(350, 10)).toBe(20);
    expect(circularDistance(0, 180)).toBe(180);
    expect(circularDistance(90, 90)).toBe(0);
  });
});

describe("pickPosterHues", () => {
  it("gives red's hue for a solid pure red poster, and a second hue 40 degrees on", () => {
    const hues = pickPosterHues(solid(100, 255, 0, 0));
    expect(hues).not.toBeNull();
    expect(circularDistance(hues!.h1, RED_HUE)).toBeLessThanOrEqual(5);
    expect(hues!.h2).toBe((hues!.h1 + 40) % 360);
  });

  it("returns null for solid grey", () => {
    expect(pickPosterHues(solid(100, 128, 128, 128))).toBeNull();
  });

  it("returns null for pure black and pure white", () => {
    expect(pickPosterHues(solid(100, 0, 0, 0))).toBeNull();
    expect(pickPosterHues(solid(100, 255, 255, 255))).toBeNull();
  });

  it("finds red and blue for a half red, half blue poster", () => {
    const hues = pickPosterHues(two(50, [255, 0, 0, 255], 50, [0, 0, 255, 255]));
    expect(hues).not.toBeNull();
    const near = [hues!.h1, hues!.h2];
    expect(near.some((h) => circularDistance(h, RED_HUE) <= 5)).toBe(true);
    expect(near.some((h) => circularDistance(h, BLUE_HUE) <= 5)).toBe(true);
  });

  it("ignores transparent pixels, so a red image with a large transparent grey area is still red", () => {
    const data = two(50, [255, 0, 0, 255], 200, [128, 128, 128, 0]);
    const hues = pickPosterHues(data);
    expect(hues).not.toBeNull();
    expect(circularDistance(hues!.h1, RED_HUE)).toBeLessThanOrEqual(5);
  });

  it("returns null when only 5% of the opaque pixels are colourful", () => {
    expect(pickPosterHues(two(95, [128, 128, 128, 255], 5, [255, 0, 0, 255]))).toBeNull();
  });

  it("returns null when there are no opaque pixels", () => {
    expect(pickPosterHues(solid(10, 255, 0, 0, 0))).toBeNull();
  });

  it("returns integer hues from 0 to 359", () => {
    const hues = pickPosterHues(two(50, [255, 0, 0, 255], 50, [0, 0, 255, 255]));
    for (const h of [hues!.h1, hues!.h2]) {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(359);
    }
  });
});

import { describe, expect, it } from "vitest";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, previewPosition } from "./poster-preview";

const viewport = { width: 1000, height: 800 };
// A 24x36 thumbnail at (left 20, top 300).
const thumb = { top: 300, left: 20, right: 44, height: 36 };

describe("previewPosition", () => {
  it("sits to the right of the thumbnail, centred on it", () => {
    expect(previewPosition(thumb, viewport)).toStrictEqual({ top: 300 + 18 - 120, left: 52 });
  });

  it("clamps to the top margin when the thumbnail is near the top", () => {
    expect(previewPosition({ ...thumb, top: 10 }, viewport)).toStrictEqual({ top: 8, left: 52 });
  });

  it("clamps to the bottom margin when the thumbnail is near the bottom", () => {
    const top = viewport.height - 8 - PREVIEW_HEIGHT;
    expect(previewPosition({ ...thumb, top: 780 }, viewport).top).toBe(top);
  });

  it("flips to the left of the thumbnail near the right edge", () => {
    const nearRight = { top: 300, left: 900, right: 924, height: 36 };
    expect(previewPosition(nearRight, viewport)).toStrictEqual({ top: 198, left: 900 - 8 - PREVIEW_WIDTH });
  });

  it("pins to the top margin when the viewport is shorter than the preview", () => {
    expect(previewPosition(thumb, { width: 1000, height: 200 }).top).toBe(8);
  });

  it("opens on the left when asked and there is room", () => {
    const wide = { top: 300, left: 400, right: 700, height: 36 };
    expect(previewPosition(wide, viewport, "left").left).toBe(400 - 8 - PREVIEW_WIDTH);
  });

  it("falls back to the right of the rect when the left has no room", () => {
    const wide = { top: 300, left: 100, right: 400, height: 36 };
    expect(previewPosition(wide, viewport, "left").left).toBe(408);
  });
});

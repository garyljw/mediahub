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
});

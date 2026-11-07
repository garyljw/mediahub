import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FOCUS, focusFromCrop, objectPosition, readFocus, writeFocus } from "./backdrop-focus";

const image = { width: 1280, height: 720 };
// A phone-ish box is taller than the 16:9 image, so cover scales by height and the x axis has the slack.
const phone = { width: 390, height: 844 };
// A 9:1 header: cover scales by width and the y axis has the slack.
const wide = { width: 3200, height: 350 };

describe("objectPosition", () => {
  it("clamps the y axis to the top for a focus near the top of a wide box", () => {
    expect(objectPosition({ x: 0.5, y: 0 }, image, wide)).toBe("50% 0%");
    expect(objectPosition({ x: 0.5, y: 0.05 }, image, wide)).toBe("50% 0%");
  });

  it("centres the y axis for a focus in the middle of a wide box", () => {
    expect(objectPosition({ x: 0.5, y: 0.5 }, image, wide)).toBe("50% 50%");
  });

  it("clamps the y axis to the bottom for a focus at the bottom of a wide box", () => {
    expect(objectPosition({ x: 0.5, y: 1 }, image, wide)).toBe("50% 100%");
  });

  it("slides the y axis by a mid value", () => {
    expect(objectPosition({ x: 0.5, y: 0.3 }, image, wide)).toBe("50% 25.2%");
  });

  it("uses the x axis for a tall box", () => {
    expect(objectPosition({ x: 0, y: 0.25 }, image, phone)).toBe("0% 50%");
    expect(objectPosition({ x: 1, y: 0.25 }, image, phone)).toBe("100% 50%");
    expect(objectPosition({ x: 0.5, y: 0.9 }, image, phone)).toBe("50% 50%");
  });

  it("centres both axes when the box has no slack", () => {
    expect(objectPosition({ x: 0.1, y: 0.9 }, image, image)).toBe("50% 50%");
  });

  it("falls back to the default when a size is zero", () => {
    expect(objectPosition({ x: 0.9, y: 0.9 }, image, { width: 0, height: 350 })).toBe("50% 25%");
    expect(objectPosition({ x: 0.9, y: 0.9 }, { width: 0, height: 720 }, wide)).toBe("50% 25%");
    expect(objectPosition({ x: 0.9, y: 0.9 }, image, { width: 3200, height: 0 })).toBe("50% 25%");
  });
});

describe("focusFromCrop", () => {
  it("returns the centre of the crop as fractions of the image", () => {
    expect(focusFromCrop({ x: 100, y: 50, width: 200, height: 100 }, { width: 1000, height: 500 })).toStrictEqual({
      x: 0.2,
      y: 0.2,
    });
  });

  it("clamps a centre that runs past the image edge", () => {
    expect(focusFromCrop({ x: 900, y: 0, width: 400, height: 100 }, { width: 1000, height: 500 })).toStrictEqual({
      x: 1,
      y: 0.1,
    });
  });

  it("returns null for an image with no size", () => {
    expect(focusFromCrop({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 500 })).toBeNull();
    expect(focusFromCrop({ x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: 0 })).toBeNull();
  });

  it("returns null when any number is not finite", () => {
    expect(focusFromCrop({ x: Number.NaN, y: 0, width: 10, height: 10 }, { width: 1000, height: 500 })).toBeNull();
    expect(focusFromCrop({ x: 0, y: 0, width: Infinity, height: 10 }, { width: 1000, height: 500 })).toBeNull();
    expect(focusFromCrop({ x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: Number.NaN })).toBeNull();
  });
});

/** A Map-backed stand-in for window.localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

const SRC = "/api/backdrop/42";
const KEY = `mediahub:backdrop-focus:${SRC}`;

describe("readFocus and writeFocus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the focus under a key for the src, rounded to 3 decimals", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    writeFocus(SRC, { x: 1 / 3, y: 0.12345 });
    expect(storage.store.get(KEY)).toBe('{"x":0.333,"y":0.123}');
  });

  it("reads back what was written", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    writeFocus(SRC, { x: 0.25, y: 0.75 });
    expect(readFocus(SRC)).toStrictEqual({ x: 0.25, y: 0.75 });
  });

  it("returns null when nothing is stored for the src", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(readFocus(SRC)).toBeNull();
  });

  it("returns null for stored junk", () => {
    const junk = [
      "not json",
      "null",
      "42",
      '"text"',
      '{"x":0.5}',
      '{"x":"0.5","y":0.5}',
      '{"x":1.5,"y":0.5}',
      '{"x":0.5,"y":-0.1}',
      '{"x":null,"y":0.5}',
    ];
    for (const value of junk) {
      vi.stubGlobal("localStorage", fakeStorage({ [KEY]: value }));
      expect(readFocus(SRC), value).toBeNull();
    }
  });

  it("returns null and does not throw when storage throws on read", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    });
    expect(readFocus(SRC)).toBeNull();
  });

  it("does not throw when storage throws on write", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(() => writeFocus(SRC, { x: 0.5, y: 0.5 })).not.toThrow();
  });

  it("returns null and does not throw when localStorage is missing", () => {
    // Set it missing on purpose: newer Node versions have a localStorage global of their own.
    vi.stubGlobal("localStorage", undefined);
    expect(readFocus(SRC)).toBeNull();
    expect(() => writeFocus(SRC, DEFAULT_FOCUS)).not.toThrow();
  });
});

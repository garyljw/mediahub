import { describe, expect, it } from "vitest";
import { jumpLetter, letterIndex, letterOf, letterOrder } from "./letter";
import type { HomeItem } from "./home-items";

function item(key: string, sortTitle: string): HomeItem {
  return { key, sortTitle } as HomeItem;
}

describe("letterOf", () => {
  it("gives the first letter, uppercased", () => {
    expect(letterOf("matrix")).toBe("M");
    expect(letterOf("Matrix")).toBe("M");
  });

  it("strips accents before picking the letter", () => {
    expect(letterOf("élan")).toBe("E");
  });

  it("gives # for a digit, a symbol and an empty title", () => {
    expect(letterOf("1917")).toBe("#");
    expect(letterOf("[rec]")).toBe("#");
    expect(letterOf("")).toBe("#");
  });
});

describe("letterIndex", () => {
  it("maps each letter to the first shown key with that letter", () => {
    const shown = [item("movie:1", "alien"), item("movie:2", "amelie"), item("series:3", "bones")];
    expect(letterIndex(shown)).toEqual(
      new Map([
        ["A", "movie:1"],
        ["B", "series:3"],
      ]),
    );
  });
});

describe("letterOrder", () => {
  it("puts # first and reverses for descending", () => {
    expect(letterOrder("asc").slice(0, 3)).toEqual(["#", "A", "B"]);
    expect(letterOrder("desc").slice(0, 3)).toEqual(["Z", "Y", "X"]);
    expect(letterOrder("desc").at(-1)).toBe("#");
  });
});

describe("jumpLetter", () => {
  const order = letterOrder("asc");

  it("goes to the letter itself when it has titles", () => {
    expect(jumpLetter("M", order, new Set(["M", "N"]))).toBe("M");
  });

  it("skips a dimmed letter forward in ascending order", () => {
    expect(jumpLetter("C", order, new Set(["B", "D"]))).toBe("D");
  });

  it("skips a dimmed letter forward in descending order", () => {
    const desc = letterOrder("desc");
    expect(jumpLetter("M", desc, new Set(["L", "K"]))).toBe("L");
  });

  it("returns null when no letter after it has titles", () => {
    expect(jumpLetter("X", order, new Set(["B"]))).toBeNull();
  });
});

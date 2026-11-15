import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPlainClick,
  readPlace,
  restoreTop,
  topIfOpen,
  writePlace,
  type Place,
} from "./return-place";

/** A fake sessionStorage with the given behaviour: a plain map, or a store whose every call throws. */
function stubStorage(store: Map<string, string> | "throws") {
  const throwing = () => {
    throw new Error("storage unavailable");
  };
  const fake =
    store === "throws"
      ? { getItem: throwing, setItem: throwing, removeItem: throwing }
      : {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => void store.set(key, value),
          removeItem: (key: string) => void store.delete(key),
        };
  vi.stubGlobal("sessionStorage", fake);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const KEY = "mediahub.place:/";

describe("topIfOpen from another page", () => {
  it("forgets Popular's place so the nav opens it at the top, but keeps Home's", () => {
    const place: Place = { scrollY: 900, tileKey: "trending-tv:tv-7", tileTop: 140, filter: null };
    stubStorage(new Map());
    writePlace("/popular", place);
    writePlace("/", { ...place, tileKey: "movie:12" });

    expect(topIfOpen("/popular", "/movies/12")).toBe(false);
    expect(topIfOpen("/", "/movies/12")).toBe(false);

    expect(readPlace("/popular")).toBeNull();
    expect(readPlace("/")).toEqual({ ...place, tileKey: "movie:12" });
  });
});

describe("readPlace and writePlace", () => {
  it("reads back a place that was written", () => {
    const place: Place = { scrollY: 900, tileKey: "movie:12", tileTop: 140, filter: { search: "dune", kind: "movie", watched: "any", genre: "Science Fiction" } };
    stubStorage(new Map());
    writePlace("/", place);
    expect(readPlace("/")).toEqual(place);
  });

  it.each([
    ["not JSON", "{oops"],
    ["a string", JSON.stringify("hello")],
    ["a negative scroll", JSON.stringify({ scrollY: -5, tileKey: null, tileTop: null, filter: null })],
    ["a non-numeric scroll", JSON.stringify({ scrollY: "10", tileKey: null, tileTop: null, filter: null })],
    ["a numeric tile key", JSON.stringify({ scrollY: 1, tileKey: 7, tileTop: null, filter: null })],
    ["a filter with an unknown kind", JSON.stringify({ scrollY: 1, tileKey: null, tileTop: null, filter: { search: "", kind: "book", watched: "any" } })],
    ["a filter with an unknown watch state", JSON.stringify({ scrollY: 1, tileKey: null, tileTop: null, filter: { search: "", kind: "all", watched: "maybe" } })],
    ["a filter with a non-string genre", JSON.stringify({ scrollY: 1, tileKey: null, tileTop: null, filter: { search: "", kind: "all", watched: "any", genre: 7 } })],
    ["no filter key at all", JSON.stringify({ scrollY: 1, tileKey: null, tileTop: null })],
  ])("ignores a stored value that is %s", (_, raw) => {
    stubStorage(new Map([[KEY, raw]]));
    expect(readPlace("/")).toBeNull();
  });

  it.each([
    ["saved before the genre filter", {}],
    ["with an empty genre", { genre: "" }],
  ])("reads a place %s as having no genre", (_, extra) => {
    const old = { scrollY: 5, tileKey: null, tileTop: null, filter: { search: "x", kind: "all", watched: "any", ...extra } };
    stubStorage(new Map([[KEY, JSON.stringify(old)]]));
    expect(readPlace("/")?.filter).toEqual({ search: "x", kind: "all", watched: "any", genre: null });
  });

  it("gives no place, and writes do not throw, when storage throws", () => {
    stubStorage("throws");
    expect(readPlace("/")).toBeNull();
    expect(() => writePlace("/", { scrollY: 1, tileKey: null, tileTop: null, filter: null })).not.toThrow();
  });
});

describe("restoreTop", () => {
  it("puts the tile where it was in the viewport", () => {
    expect(restoreTop(1500, 140)).toBe(1360);
  });

  it("never goes above the top of the page", () => {
    expect(restoreTop(100, 400)).toBe(0);
  });
});

describe("isPlainClick", () => {
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it("takes a plain left click", () => {
    expect(isPlainClick(plain)).toBe(true);
  });

  it.each([
    ["middle button", { button: 1 }],
    ["cmd", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
  ])("leaves a %s click to the browser", (_, change) => {
    expect(isPlainClick({ ...plain, ...change })).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { MouseEvent } from "react";
import {
  backTarget,
  isPlainClick,
  isStaleBackFrom,
  readBackFrom,
  readPlace,
  rememberOpenedFrom,
  restoreTop,
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

describe("readPlace and writePlace", () => {
  it("reads back a place that was written", () => {
    const place: Place = { scrollY: 900, tileKey: "movie:12", tileTop: 140, filter: { search: "dune", kind: "movie", watched: "any" } };
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
    ["no filter key at all", JSON.stringify({ scrollY: 1, tileKey: null, tileTop: null })],
  ])("ignores a stored value that is %s", (_, raw) => {
    stubStorage(new Map([[KEY, raw]]));
    expect(readPlace("/")).toBeNull();
  });

  it("gives no place, and writes do not throw, when storage throws", () => {
    stubStorage("throws");
    expect(readPlace("/")).toBeNull();
    expect(() => writePlace("/", { scrollY: 1, tileKey: null, tileTop: null, filter: null })).not.toThrow();
  });
});

describe("readBackFrom", () => {
  it("ignores a page that is not a back source", () => {
    stubStorage(new Map([["mediahub.backFrom", JSON.stringify({ list: "/settings", itemPath: "/movies/1" })]]));
    expect(readBackFrom()).toBeNull();
  });
});

describe("rememberOpenedFrom", () => {
  // The tests run without a DOM: a stand-in Element whose closest("a[href]") finds a link with this href, or none.
  class FakeElement {
    constructor(private readonly href: string | null) {}
    closest() {
      return this.href === null ? null : { getAttribute: () => this.href };
    }
  }
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  function click(href: string | null, keys: Partial<typeof plain> = {}) {
    vi.stubGlobal("Element", FakeElement);
    const store = new Map<string, string>();
    stubStorage(store);
    rememberOpenedFrom("/calendar")({ ...plain, ...keys, target: new FakeElement(href) } as unknown as MouseEvent<HTMLElement>);
    return store.get("mediahub.backFrom") ?? null;
  }

  it("remembers a plain click on a title link", () => {
    expect(JSON.parse(click("/movies/12") ?? "null")).toEqual({ list: "/calendar", itemPath: "/movies/12" });
  });

  it.each([
    ["a link to a page that isn't a title", "/history?limit=200", {}],
    ["a click that isn't on a link", null, {}],
    ["a cmd-click that opens a new tab", "/tv/3", { metaKey: true }],
  ] as const)("ignores %s", (_, href, keys) => {
    expect(click(href, keys)).toBeNull();
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

describe("backTarget", () => {
  it.each([
    ["/", "Home"],
    ["/focus/movies", "Movie Focus"],
    ["/focus/tv", "TV Focus"],
    ["/calendar", "Calendar"],
    ["/queue", "Queue"],
    ["/history", "History"],
  ] as const)("goes back to %s, labelled %s, when it opened this title", (list, label) => {
    expect(backTarget({ list, itemPath: "/movies/12" }, "/movies/12")).toEqual({ mode: "back", list, label });
  });

  it("links to Home when the title was opened from another page", () => {
    expect(backTarget({ list: "/focus/tv", itemPath: "/tv/3" }, "/movies/12")).toEqual({ mode: "link", href: "/", label: "Home" });
  });

  it("links to Home when nothing is stored", () => {
    expect(backTarget(null, "/tv/3")).toEqual({ mode: "link", href: "/", label: "Home" });
  });
});

describe("isStaleBackFrom", () => {
  const stored = { list: "/" as const, itemPath: "/movies/12" };

  it.each([
    ["the title itself", "/movies/12", false],
    ["the list it came from", "/", false],
    ["another page, such as Queue", "/queue", true],
    ["another title", "/movies/13", true],
  ])("on %s gives %s", (_, pathname, stale) => {
    expect(isStaleBackFrom(stored, pathname)).toBe(stale);
  });

  it("is never stale when nothing is stored", () => {
    expect(isStaleBackFrom(null, "/queue")).toBe(false);
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

import { describe, expect, it } from "vitest";
import { addHref, parseAddParams } from "./add-link";

function roundTrip(search: string, kind: "all" | "movie" | "series") {
  const url = new URL(addHref({ search, kind }), "http://example.test");
  return { path: url.pathname, ...parseAddParams({ q: url.searchParams.get("q") ?? undefined, kind: url.searchParams.get("kind") ?? undefined }), hasKind: url.searchParams.has("kind") };
}

describe("addHref and parseAddParams", () => {
  it("returns the same term, with special characters, and the kind", () => {
    const result = roundTrip("Tom & Jerry? 2 x", "series");
    expect(result).toMatchObject({ path: "/add", query: "Tom & Jerry? 2 x", kind: "series" });
  });

  it("leaves kind out for All", () => {
    expect(roundTrip("Alien", "all").hasKind).toBe(false);
  });

  it("is plain /add without a term", () => {
    expect(addHref({ search: "   ", kind: "movie" })).toBe("/add");
  });

  it.each([
    [{}, { query: "", kind: "all" }],
    [{ q: ["First", "Second"], kind: ["movie", "series"] }, { query: "First", kind: "movie" }],
    [{ q: "x", kind: "documentary" }, { query: "x", kind: "all" }],
    [{ q: "a".repeat(150) }, { query: "a".repeat(100), kind: "all" }],
    [{ q: "   " }, { query: "", kind: "all" }],
  ])("parses %j", (raw, expected) => {
    expect(parseAddParams(raw)).toEqual(expected);
  });
});

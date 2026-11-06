import { describe, expect, it } from "vitest";
import type { HomeItem } from "@/components/home/home-items";
import { LIBRARY_LIMIT, libraryMatches, libraryRowKey, remoteRowKey, remoteTerm } from "./focus-add-items";

function item(kind: HomeItem["kind"], id: number, title: string, year: number | null = null): HomeItem {
  return {
    key: `${kind}-${id}`,
    kind,
    id,
    title,
    year,
    sortTitle: title.toLowerCase(),
    added: null,
    href: `/${kind === "movie" ? "movies" : "tv"}/${id}`,
    posterSrc: null,
    badge: { label: "Missing", className: "" },
    watched: null,
    inFocus: false,
  };
}

describe("libraryMatches", () => {
  const candidates = [item("movie", 1, "Alien", 1979), item("movie", 2, "Aliens", 1986), item("series", 3, "Alien Nation", 1989)];

  it("matches nothing for a blank search", () => {
    expect(libraryMatches(candidates, "movie", "")).toEqual([]);
    expect(libraryMatches(candidates, "movie", "   ")).toEqual([]);
  });

  it("matches the title and the year, case-insensitively, for the kind only", () => {
    expect(libraryMatches(candidates, "movie", "ALIEN").map((row) => row.id)).toEqual([1, 2]);
    expect(libraryMatches(candidates, "movie", "1986").map((row) => row.id)).toEqual([2]);
    expect(libraryMatches(candidates, "series", "alien").map((row) => row.id)).toEqual([3]);
  });

  it("trims the search before matching", () => {
    expect(libraryMatches(candidates, "movie", "  aliens  ").map((row) => row.id)).toEqual([2]);
  });

  it("shows at most LIBRARY_LIMIT matches, in the given order", () => {
    const many = Array.from({ length: LIBRARY_LIMIT + 5 }, (_, index) => item("movie", index + 1, `Run ${index + 1}`));
    const shown = libraryMatches(many, "movie", "run");
    expect(shown).toHaveLength(LIBRARY_LIMIT);
    expect(shown.map((row) => row.id)).toEqual(many.slice(0, LIBRARY_LIMIT).map((row) => row.id));
  });
});

describe("remoteTerm", () => {
  it("returns the trimmed term when it is at least two characters", () => {
    expect(remoteTerm("  ab  ")).toBe("ab");
  });

  it("returns null for a term shorter than two characters, or blank", () => {
    expect(remoteTerm("")).toBeNull();
    expect(remoteTerm("   ")).toBeNull();
    expect(remoteTerm(" a ")).toBeNull();
  });

  it("caps the term at 100 characters", () => {
    expect(remoteTerm("x".repeat(150))).toHaveLength(100);
  });
});

describe("row keys", () => {
  it("keeps library and remote keys apart, even for the same id", () => {
    expect(libraryRowKey({ id: 7 })).toBe("library-7");
    expect(remoteRowKey({ externalId: 7 })).toBe("remote-7");
    expect(libraryRowKey({ id: 7 })).not.toBe(remoteRowKey({ externalId: 7 }));
  });
});

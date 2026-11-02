import { describe, expect, it } from "vitest";
import { compareHomeItems, filterHomeItems, type HomeItem } from "./home-items";

function item(overrides: Partial<HomeItem> & { id: number; title: string; kind: HomeItem["kind"] }): HomeItem {
  return {
    key: `${overrides.kind}:${overrides.id}`,
    year: null,
    sortTitle: overrides.title.toLowerCase(),
    added: null,
    href: `/${overrides.kind}/${overrides.id}`,
    posterSrc: null,
    badge: { label: "Missing", className: "" },
    ...overrides,
  };
}

const items: HomeItem[] = [
  item({ kind: "movie", id: 1, title: "Harbour Lights", year: 2019 }),
  item({ kind: "series", id: 2, title: "Harbour Watch", year: 2021 }),
  item({ kind: "movie", id: 3, title: "Night Circuit", year: 2024 }),
  item({ kind: "series", id: 4, title: "Glass Orchard" }),
];

const titles = (list: HomeItem[]) => list.map((entry) => entry.title);

describe("filterHomeItems", () => {
  it("returns everything for kind all and an empty search", () => {
    expect(filterHomeItems(items, { kind: "all", search: "" })).toHaveLength(4);
  });

  it("keeps only movies or only series", () => {
    expect(titles(filterHomeItems(items, { kind: "movie", search: "" }))).toEqual(["Harbour Lights", "Night Circuit"]);
    expect(titles(filterHomeItems(items, { kind: "series", search: "" }))).toEqual(["Harbour Watch", "Glass Orchard"]);
  });

  it("matches the title case-insensitively", () => {
    expect(titles(filterHomeItems(items, { kind: "all", search: "HARBOUR" }))).toEqual([
      "Harbour Lights",
      "Harbour Watch",
    ]);
  });

  it("matches the year", () => {
    expect(titles(filterHomeItems(items, { kind: "all", search: "2024" }))).toEqual(["Night Circuit"]);
  });

  it("ignores surrounding spaces in the search", () => {
    expect(titles(filterHomeItems(items, { kind: "all", search: "  glass  " }))).toEqual(["Glass Orchard"]);
  });

  it("applies the kind and the search together", () => {
    expect(titles(filterHomeItems(items, { kind: "series", search: "harbour" }))).toEqual(["Harbour Watch"]);
  });

  it("returns nothing when no title or year matches", () => {
    expect(filterHomeItems(items, { kind: "all", search: "zzz" })).toEqual([]);
  });

  it("matches part of a year", () => {
    // "202" is inside both 2021 and 2024.
    expect(titles(filterHomeItems(items, { kind: "all", search: "202" }))).toEqual(["Harbour Watch", "Night Circuit"]);
  });
});

describe("compareHomeItems", () => {
  it("puts the newest added date first", () => {
    const older = item({ kind: "movie", id: 1, title: "Alpha", added: "2026-01-01T00:00:00Z" });
    const newer = item({ kind: "movie", id: 2, title: "Zulu", added: "2026-06-01T00:00:00Z" });
    expect([older, newer].sort(compareHomeItems).map((entry) => entry.title)).toEqual(["Zulu", "Alpha"]);
  });

  it("puts items with no date last", () => {
    const dated = item({ kind: "series", id: 1, title: "Zulu", added: "2020-01-01T00:00:00Z" });
    const undated = item({ kind: "movie", id: 2, title: "Alpha", added: null });
    expect([undated, dated].sort(compareHomeItems).map((entry) => entry.title)).toEqual(["Zulu", "Alpha"]);
  });

  it("breaks date ties by title with the collator (accents sort in place)", () => {
    const same = "2026-03-03T00:00:00Z";
    const e = item({ kind: "movie", id: 1, title: "Éclair", sortTitle: "éclair", added: same });
    const z = item({ kind: "movie", id: 2, title: "Zulu", sortTitle: "zulu", added: same });
    const a = item({ kind: "movie", id: 3, title: "Alpha", sortTitle: "alpha", added: same });
    expect([z, e, a].sort(compareHomeItems).map((entry) => entry.title)).toEqual(["Alpha", "Éclair", "Zulu"]);
  });

  it("puts a movie before a series when everything else ties", () => {
    const series = item({ kind: "series", id: 1, title: "Same", added: null });
    const movie = item({ kind: "movie", id: 9, title: "Same", added: null });
    expect([series, movie].sort(compareHomeItems).map((entry) => entry.kind)).toEqual(["movie", "series"]);
  });

  it("breaks the last tie by id", () => {
    const high = item({ kind: "movie", id: 9, title: "Same", added: null });
    const low = item({ kind: "movie", id: 2, title: "Same", added: null });
    expect([high, low].sort(compareHomeItems).map((entry) => entry.id)).toEqual([2, 9]);
  });
});

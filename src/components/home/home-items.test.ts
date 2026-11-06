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
    watched: null,
    inFocus: false,
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
  const sorted = (list: HomeItem[]) => [...list].sort(compareHomeItems);

  it("sorts A–Z by sort title, ignoring the added date", () => {
    const zulu = item({ kind: "movie", id: 1, title: "Zulu", added: "2026-06-01T00:00:00Z" });
    const alpha = item({ kind: "series", id: 2, title: "Alpha", added: "2020-01-01T00:00:00Z" });
    expect(titles(sorted([zulu, alpha]))).toEqual(["Alpha", "Zulu"]);
  });

  it("uses the sort title, so a leading article doesn't count", () => {
    const beekeeper = item({ kind: "movie", id: 1, title: "The Beekeeper", sortTitle: "beekeeper" });
    const carrie = item({ kind: "movie", id: 2, title: "Carrie", sortTitle: "carrie" });
    const alpha = item({ kind: "movie", id: 3, title: "Alpha", sortTitle: "alpha" });
    expect(titles(sorted([carrie, beekeeper, alpha]))).toEqual(["Alpha", "The Beekeeper", "Carrie"]);
  });

  it("sorts accented titles in place", () => {
    const e = item({ kind: "movie", id: 1, title: "Éclair", sortTitle: "éclair" });
    const z = item({ kind: "movie", id: 2, title: "Zulu", sortTitle: "zulu" });
    const a = item({ kind: "movie", id: 3, title: "Alpha", sortTitle: "alpha" });
    expect(titles(sorted([z, e, a]))).toEqual(["Alpha", "Éclair", "Zulu"]);
  });

  it("puts a movie before a series when the sort titles tie", () => {
    const series = item({ kind: "series", id: 1, title: "Same" });
    const movie = item({ kind: "movie", id: 9, title: "Same" });
    expect(sorted([series, movie]).map((entry) => entry.kind)).toEqual(["movie", "series"]);
  });

  it("breaks the last tie by id", () => {
    const high = item({ kind: "movie", id: 9, title: "Same" });
    const low = item({ kind: "movie", id: 2, title: "Same" });
    expect(sorted([high, low]).map((entry) => entry.id)).toEqual([2, 9]);
  });
});

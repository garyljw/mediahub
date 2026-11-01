import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  clampPage,
  compareValues,
  nextSort,
  pageCount,
  pageSlice,
  profileOptions,
  sortRows,
  type SortDir,
} from "./list";

describe("paging", () => {
  it("uses 100 rows per page", () => {
    expect(PAGE_SIZE).toBe(100);
  });

  it("always has at least one page", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(100)).toBe(1);
    expect(pageCount(101)).toBe(2);
    expect(pageCount(250)).toBe(3);
  });

  it("clamps the page number into range and treats non-numbers as page 1", () => {
    expect(clampPage(0, 250)).toBe(1);
    expect(clampPage(-4, 250)).toBe(1);
    expect(clampPage(2, 250)).toBe(2);
    expect(clampPage(9, 250)).toBe(3);
    expect(clampPage(5, 0)).toBe(1);
    expect(clampPage(Number.NaN, 250)).toBe(1);
    expect(clampPage(2.7, 250)).toBe(2);
    expect(clampPage(9, 300)).toBe(3);
  });

  it("slices one page of items", () => {
    const items = Array.from({ length: 250 }, (_, i) => i + 1);
    expect(pageSlice(items, 1)).toHaveLength(100);
    expect(pageSlice(items, 1)[0]).toBe(1);
    expect(pageSlice(items, 2)[0]).toBe(101);
    expect(pageSlice(items, 3)).toEqual(items.slice(200));
  });

  it("returns the last page when asked for a page past the end, so a stale page is never empty", () => {
    const items = Array.from({ length: 250 }, (_, i) => i + 1);
    expect(pageSlice(items, 99)).toEqual(items.slice(200));
    const shorter = Array.from({ length: 150 }, (_, i) => i);
    expect(pageSlice(shorter, 2)).toHaveLength(50);
    expect(pageSlice(shorter, 9)[0]).toBe(100);
  });

  it("returns an empty slice for no items", () => {
    expect(pageSlice([], 1)).toEqual([]);
    expect(pageSlice([], 5)).toEqual([]);
  });
});

const FIRST: Record<"title" | "year" | "size", SortDir> = { title: "asc", year: "desc", size: "desc" };

describe("nextSort", () => {
  it("flips direction when the active column is clicked again", () => {
    expect(nextSort({ key: "title", dir: "asc" }, "title", FIRST)).toEqual({ key: "title", dir: "desc" });
    expect(nextSort({ key: "title", dir: "desc" }, "title", FIRST)).toEqual({ key: "title", dir: "asc" });
  });

  it("starts a new column in the first direction given for it", () => {
    expect(nextSort({ key: "title", dir: "asc" }, "year", FIRST)).toEqual({ key: "year", dir: "desc" });
    expect(nextSort({ key: "year", dir: "desc" }, "title", FIRST)).toEqual({ key: "title", dir: "asc" });
  });
});

describe("compareValues", () => {
  it("sorts missing values last in both directions", () => {
    expect(compareValues(null, 1, "asc")).toBeGreaterThan(0);
    expect(compareValues(1, null, "desc")).toBeLessThan(0);
    expect(compareValues(null, null, "asc")).toBe(0);
  });

  it("reverses numbers for descending", () => {
    expect(compareValues(1, 2, "asc")).toBeLessThan(0);
    expect(compareValues(1, 2, "desc")).toBeGreaterThan(0);
  });
});

describe("sortRows", () => {
  type Row = { id: number; sortTitle: string; year: number | null };
  const rows: Row[] = [
    { id: 9, sortTitle: "same", year: 2000 },
    { id: 7, sortTitle: "same", year: 2000 },
    { id: 8, sortTitle: "aardvark", year: 2000 },
    { id: 1, sortTitle: "zulu", year: null },
  ];

  it("sorts by the value, then by title, then by id, with missing values last", () => {
    const sorted = sortRows(rows, { key: "year", dir: "asc" }, (row) => row.year);
    expect(sorted.map((row) => row.id)).toEqual([8, 7, 9, 1]);
  });

  it("reads each row's value once, not once per comparison", () => {
    let reads = 0;
    sortRows(rows, { key: "year", dir: "asc" }, (row) => {
      reads += 1;
      return row.year;
    });
    expect(reads).toBe(rows.length);
  });

  it("returns a new array and leaves the input alone", () => {
    const copy = [...rows];
    const sorted = sortRows(rows, { key: "year", dir: "desc" }, (row) => row.year);
    expect(sorted).not.toBe(rows);
    expect(rows).toEqual(copy);
  });
});

describe("profileOptions", () => {
  it("adds one Unknown option per profile id the rows use but the list no longer has, sorted by id", () => {
    const rows = [
      { qualityProfileId: 7, qualityProfile: "Unknown profile (#7)" },
      { qualityProfileId: 1, qualityProfile: "HD-1080p" },
      { qualityProfileId: 5, qualityProfile: "Unknown profile (#5)" },
    ];
    expect(profileOptions(rows, [{ id: 1, name: "HD-1080p" }])).toEqual([
      { id: 1, name: "HD-1080p" },
      { id: 5, name: "Unknown profile (#5)" },
      { id: 7, name: "Unknown profile (#7)" },
    ]);
  });
});

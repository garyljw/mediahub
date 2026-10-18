import { describe, expect, it } from "vitest";
import type { MovieRow } from "@/server/arr/movies";
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  clampPage,
  filterMovies,
  hasActiveFilters,
  matchesSearch,
  nextSort,
  pageCount,
  pageSlice,
  profileOptions,
  sortMovies,
  type MovieFilters,
} from "./movie-filters";

function row(overrides: Partial<MovieRow> & { id: number; title: string }): MovieRow {
  return {
    year: null,
    status: "missing",
    monitored: true,
    qualityProfileId: 1,
    qualityProfile: "HD-1080p",
    fileQuality: null,
    sizeOnDisk: 0,
    added: null,
    sortTitle: overrides.title.toLowerCase(),
    ...overrides,
  };
}

const rows: MovieRow[] = [
  row({ id: 1, title: "Alpha", year: 2019, status: "downloaded", monitored: true, qualityProfileId: 1, sizeOnDisk: 500, added: "2024-03-12T10:00:00Z", fileQuality: "Bluray-1080p" }),
  row({ id: 2, title: "Bravo", year: 2021, status: "missing", monitored: true, qualityProfileId: 2, added: "2024-05-01T08:00:00Z" }),
  row({ id: 3, title: "Charlie", year: 2027, status: "unreleased", monitored: false, qualityProfileId: 1, added: "2026-01-15T09:00:00Z" }),
  row({ id: 4, title: "Delta Force", year: 2008, status: "downloaded", monitored: false, qualityProfileId: 3, sizeOnDisk: 2000, added: "2023-11-02T12:00:00.250Z", fileQuality: "WEBDL-720p" }),
  row({ id: 5, title: "Echo", year: null, status: "missing", monitored: true, qualityProfileId: 99, qualityProfile: "Unknown profile (#99)", added: null }),
];

const withFilters = (patch: Partial<MovieFilters>): MovieFilters => ({ ...DEFAULT_FILTERS, ...patch });
const ids = (list: MovieRow[]) => list.map((r) => r.id);

describe("matchesSearch", () => {
  it("matches everything for an empty or whitespace query", () => {
    expect(matchesSearch(rows[0], "")).toBe(true);
    expect(matchesSearch(rows[0], "   ")).toBe(true);
  });

  it("matches a title substring case-insensitively", () => {
    expect(matchesSearch(rows[3], "DELTA")).toBe(true);
    expect(matchesSearch(rows[3], "  force ")).toBe(true);
    expect(matchesSearch(rows[3], "charlie")).toBe(false);
  });

  it("matches the year", () => {
    expect(matchesSearch(rows[2], "2027")).toBe(true);
    expect(matchesSearch(rows[2], "2026")).toBe(false);
  });

  it("does not match a null year against a query", () => {
    expect(matchesSearch(rows[4], "null")).toBe(false);
    expect(matchesSearch(rows[4], "0")).toBe(false);
  });
});

describe("filterMovies", () => {
  it("returns all rows with default filters", () => {
    expect(filterMovies(rows, DEFAULT_FILTERS)).toEqual(rows);
  });

  it("searches by title or year", () => {
    expect(ids(filterMovies(rows, withFilters({ search: "bravo" })))).toEqual([2]);
    expect(ids(filterMovies(rows, withFilters({ search: "2008" })))).toEqual([4]);
  });

  it("filters by status", () => {
    expect(ids(filterMovies(rows, withFilters({ status: "downloaded" })))).toEqual([1, 4]);
    expect(ids(filterMovies(rows, withFilters({ status: "missing" })))).toEqual([2, 5]);
    expect(ids(filterMovies(rows, withFilters({ status: "unreleased" })))).toEqual([3]);
  });

  it("filters by monitored state", () => {
    expect(ids(filterMovies(rows, withFilters({ monitored: "monitored" })))).toEqual([1, 2, 5]);
    expect(ids(filterMovies(rows, withFilters({ monitored: "unmonitored" })))).toEqual([3, 4]);
  });

  it("filters by quality profile id, including the Unknown profile", () => {
    expect(ids(filterMovies(rows, withFilters({ profileId: 1 })))).toEqual([1, 3]);
    expect(ids(filterMovies(rows, withFilters({ profileId: 99 })))).toEqual([5]);
  });

  it("combines filters with AND", () => {
    expect(
      ids(filterMovies(rows, withFilters({ status: "downloaded", monitored: "unmonitored", profileId: 3 }))),
    ).toEqual([4]);
    expect(ids(filterMovies(rows, withFilters({ status: "missing", search: "charlie" })))).toEqual([]);
  });

  it("does not mutate the input", () => {
    const copy = [...rows];
    filterMovies(rows, withFilters({ status: "missing" }));
    expect(rows).toEqual(copy);
  });
});

describe("hasActiveFilters", () => {
  it("is false for defaults and true when any filter is set", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters(withFilters({ search: "  " }))).toBe(false);
    expect(hasActiveFilters(withFilters({ search: "x" }))).toBe(true);
    expect(hasActiveFilters(withFilters({ status: "missing" }))).toBe(true);
    expect(hasActiveFilters(withFilters({ monitored: "monitored" }))).toBe(true);
    expect(hasActiveFilters(withFilters({ profileId: 2 }))).toBe(true);
  });
});

describe("sortMovies", () => {
  it("sorts by title ascending and descending", () => {
    expect(ids(sortMovies(rows, { key: "title", dir: "asc" }))).toEqual([1, 2, 3, 4, 5]);
    expect(ids(sortMovies(rows, { key: "title", dir: "desc" }))).toEqual([5, 4, 3, 2, 1]);
  });

  it("sorts by year, with a null year last in both directions", () => {
    expect(ids(sortMovies(rows, { key: "year", dir: "asc" }))).toEqual([4, 1, 2, 3, 5]);
    expect(ids(sortMovies(rows, { key: "year", dir: "desc" }))).toEqual([3, 2, 1, 4, 5]);
  });

  it("sorts by size, with no-file (zero) sizes last in both directions", () => {
    expect(ids(sortMovies(rows, { key: "size", dir: "asc" }))).toEqual([1, 4, 2, 3, 5]);
    expect(ids(sortMovies(rows, { key: "size", dir: "desc" }))).toEqual([4, 1, 2, 3, 5]);
  });

  it("sorts by added date, with a missing date last in both directions", () => {
    expect(ids(sortMovies(rows, { key: "added", dir: "asc" }))).toEqual([4, 1, 2, 3, 5]);
    expect(ids(sortMovies(rows, { key: "added", dir: "desc" }))).toEqual([3, 2, 1, 4, 5]);
  });

  it("breaks ties by title, then id", () => {
    const tied = [
      row({ id: 9, title: "Same", year: 2000 }),
      row({ id: 7, title: "Same", year: 2000 }),
      row({ id: 8, title: "Aardvark", year: 2000 }),
    ];
    expect(ids(sortMovies(tied, { key: "year", dir: "asc" }))).toEqual([8, 7, 9]);
  });

  it("returns a new array and leaves the input order alone", () => {
    const copy = [...rows];
    const sorted = sortMovies(rows, { key: "title", dir: "desc" });
    expect(sorted).not.toBe(rows);
    expect(rows).toEqual(copy);
  });
});

describe("nextSort", () => {
  it("flips direction when the active column is clicked again", () => {
    expect(nextSort({ key: "title", dir: "asc" }, "title")).toEqual({ key: "title", dir: "desc" });
    expect(nextSort({ key: "title", dir: "desc" }, "title")).toEqual({ key: "title", dir: "asc" });
  });

  it("starts a new column in its first direction", () => {
    expect(nextSort({ key: "title", dir: "asc" }, "year")).toEqual({ key: "year", dir: "desc" });
    expect(nextSort({ key: "year", dir: "desc" }, "title")).toEqual({ key: "title", dir: "asc" });
    expect(nextSort({ key: "title", dir: "asc" }, "size")).toEqual({ key: "size", dir: "desc" });
    expect(nextSort({ key: "title", dir: "asc" }, "added")).toEqual({ key: "added", dir: "desc" });
  });
});

describe("pagination", () => {
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

  it("clamps the page number into range", () => {
    expect(clampPage(0, 250)).toBe(1);
    expect(clampPage(-4, 250)).toBe(1);
    expect(clampPage(2, 250)).toBe(2);
    expect(clampPage(9, 250)).toBe(3);
    expect(clampPage(5, 0)).toBe(1);
    expect(clampPage(Number.NaN, 250)).toBe(1);
    expect(clampPage(2.7, 250)).toBe(2);
  });

  it("slices one page of items", () => {
    const items = Array.from({ length: 250 }, (_, i) => i + 1);
    expect(pageSlice(items, 1)).toHaveLength(100);
    expect(pageSlice(items, 1)[0]).toBe(1);
    expect(pageSlice(items, 2)[0]).toBe(101);
    expect(pageSlice(items, 3)).toEqual(items.slice(200));
  });

  it("returns the last page when asked for a page past the end", () => {
    const items = Array.from({ length: 250 }, (_, i) => i + 1);
    expect(pageSlice(items, 99)).toEqual(items.slice(200));
  });

  it("returns an empty slice for no items", () => {
    expect(pageSlice([], 1)).toEqual([]);
    expect(pageSlice([], 5)).toEqual([]);
  });
});

describe("profileOptions", () => {
  it("adds one Unknown option per profile id Radarr no longer lists", () => {
    const profiles = [{ id: 1, name: "HD-1080p" }, { id: 2, name: "Ultra-HD" }, { id: 3, name: "Remux" }];
    expect(profileOptions(rows, profiles)).toEqual([...profiles, { id: 99, name: "Unknown profile (#99)" }]);
    expect(profileOptions(rows.filter((r) => r.id !== 5), profiles)).toEqual(profiles);
  });
});

describe("title collation", () => {
  it("sorts accented titles alphabetically", () => {
    const accented = [row({ id: 10, title: "Zulu Dawn" }), row({ id: 11, title: "Éclair Tales" })];
    expect(ids(sortMovies(accented, { key: "title", dir: "asc" }))).toEqual([11, 10]);
  });
});

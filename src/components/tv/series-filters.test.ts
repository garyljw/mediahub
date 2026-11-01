import { describe, expect, it } from "vitest";
import type { SeriesRow } from "@/server/arr/series";
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  clampPage,
  episodeFraction,
  filterSeries,
  hasActiveFilters,
  isMissing,
  matchesSearch,
  nextSort,
  pageCount,
  pageSlice,
  profileOptions,
  sortSeries,
  type SeriesFilters,
} from "./series-filters";

function row(overrides: Partial<SeriesRow> & { id: number; title: string }): SeriesRow {
  return {
    year: null,
    status: "continuing",
    monitored: true,
    qualityProfileId: 1,
    qualityProfile: "HD-1080p",
    network: null,
    episodeFileCount: 0,
    episodeCount: 0,
    seasonCount: 0,
    sizeOnDisk: 0,
    added: null,
    sortTitle: overrides.title.toLowerCase(),
    hasPoster: false,
    ...overrides,
  };
}

const SAMPLE: SeriesRow[] = [
  row({ id: 1, title: "Harbour Lights", year: 2018, status: "continuing", episodeFileCount: 24, episodeCount: 24, sizeOnDisk: 500, added: "2024-02-10T09:00:00Z" }),
  row({ id: 2, title: "The Long Quiet", year: 2011, status: "ended", monitored: false, qualityProfileId: 2, qualityProfile: "Any", episodeFileCount: 10, episodeCount: 12, sizeOnDisk: 300, added: "2023-05-01T12:00:00Z", sortTitle: "long quiet, the" }),
  row({ id: 3, title: "Coming Soon", year: 2026, status: "upcoming", episodeFileCount: 0, episodeCount: 0, added: "2026-01-05T08:00:00Z" }),
  row({ id: 4, title: "Zulu Station", year: null, status: "ended", episodeFileCount: 3, episodeCount: 4, sizeOnDisk: 900 }),
  row({ id: 5, title: "Éclair Tales", year: 2020, qualityProfileId: 99, qualityProfile: "Unknown profile (#99)", episodeFileCount: 2, episodeCount: 6, sizeOnDisk: 700 }),
];

const ids = (rows: SeriesRow[]) => rows.map((r) => r.id);

describe("episodes", () => {
  it("counts a series expecting no episodes as complete", () => {
    expect(isMissing(row({ id: 1, title: "x", episodeFileCount: 0, episodeCount: 0 }))).toBe(false);
    expect(episodeFraction(row({ id: 1, title: "x", episodeFileCount: 0, episodeCount: 0 }))).toBe(1);
  });

  it("treats fewer files than expected as missing, with the fraction on disk", () => {
    const series = row({ id: 1, title: "x", episodeFileCount: 3, episodeCount: 4 });
    expect(isMissing(series)).toBe(true);
    expect(episodeFraction(series)).toBe(0.75);
  });

  it("caps the fraction at 1 when there are more files than expected", () => {
    const series = row({ id: 1, title: "x", episodeFileCount: 5, episodeCount: 4 });
    expect(isMissing(series)).toBe(false);
    expect(episodeFraction(series)).toBe(1);
  });
});

describe("matchesSearch", () => {
  it("matches the title case-insensitively and the year, and an empty query matches everything", () => {
    expect(matchesSearch(SAMPLE[0], "harbour")).toBe(true);
    expect(matchesSearch(SAMPLE[0], "LIGHTS")).toBe(true);
    expect(matchesSearch(SAMPLE[0], "2018")).toBe(true);
    expect(matchesSearch(SAMPLE[0], "1999")).toBe(false);
    expect(matchesSearch(SAMPLE[0], "   ")).toBe(true);
  });

  it("does not match a null year", () => {
    expect(matchesSearch(SAMPLE[3], "null")).toBe(false);
    expect(matchesSearch(SAMPLE[3], "zulu")).toBe(true);
  });
});

describe("filterSeries", () => {
  const filter = (patch: Partial<SeriesFilters>) => ids(filterSeries(SAMPLE, { ...DEFAULT_FILTERS, ...patch }));

  it("keeps everything with the default filters", () => {
    expect(filter({})).toEqual([1, 2, 3, 4, 5]);
  });

  it("filters by status", () => {
    // Row 5 is continuing too: the helper defaults to continuing.
    expect(filter({ status: "continuing" })).toEqual([1, 5]);
    expect(filter({ status: "ended" })).toEqual([2, 4]);
    expect(filter({ status: "upcoming" })).toEqual([3]);
  });

  it("filters by monitored", () => {
    expect(filter({ monitored: "unmonitored" })).toEqual([2]);
    expect(filter({ monitored: "monitored" })).toEqual([1, 3, 4, 5]);
  });

  it("filters by quality profile, including an orphaned id", () => {
    expect(filter({ profileId: 2 })).toEqual([2]);
    expect(filter({ profileId: 99 })).toEqual([5]);
  });

  it("filters by missing episodes", () => {
    expect(filter({ missing: "missing" })).toEqual([2, 4, 5]);
    expect(filter({ missing: "complete" })).toEqual([1, 3]);
  });

  it("combines filters", () => {
    expect(filter({ status: "ended", missing: "missing" })).toEqual([2, 4]);
    expect(filter({ status: "ended", missing: "complete" })).toEqual([]);
  });
});

describe("sortSeries", () => {
  const sortedIds = (key: Parameters<typeof nextSort>[1], dir: "asc" | "desc") => ids(sortSeries(SAMPLE, { key, dir }));

  it("sorts by title with accents and numbers collated", () => {
    // "Éclair" sorts with the E words, and "Coming Soon" comes before "Harbour".
    expect(sortedIds("title", "asc")).toEqual([3, 5, 1, 2, 4]);
    expect(sortedIds("title", "desc")).toEqual([4, 2, 1, 5, 3]);
  });

  it("sorts by year, with a missing year last in both directions", () => {
    expect(sortedIds("year", "asc")).toEqual([2, 1, 5, 3, 4]);
    expect(sortedIds("year", "desc")).toEqual([3, 5, 1, 2, 4]);
  });

  it("sorts by episodes as a fraction, so the least complete come first ascending", () => {
    // Fractions: 1 -> 1, 2 -> 10/12, 3 -> 1 (no episodes), 4 -> 0.75, 5 -> 1/3. Ties at 1 fall back to title.
    expect(sortedIds("episodes", "asc")).toEqual([5, 4, 2, 3, 1]);
    expect(sortedIds("episodes", "desc")).toEqual([3, 1, 2, 4, 5]);
  });

  it("sorts by size with no-file series last in both directions", () => {
    expect(sortedIds("size", "asc")).toEqual([2, 1, 5, 4, 3]);
    expect(sortedIds("size", "desc")).toEqual([4, 5, 1, 2, 3]);
  });

  it("sorts by added with missing dates last", () => {
    // The two undated series fall back to title order: "Éclair" before "Zulu".
    expect(sortedIds("added", "asc")).toEqual([2, 1, 3, 5, 4]);
    expect(sortedIds("added", "desc")).toEqual([3, 1, 2, 5, 4]);
  });

  it("returns a new array and leaves the input order alone", () => {
    const input = [...SAMPLE];
    sortSeries(input, { key: "title", dir: "desc" });
    expect(ids(input)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("nextSort", () => {
  it("flips the direction of the active column", () => {
    expect(nextSort({ key: "title", dir: "asc" }, "title")).toEqual({ key: "title", dir: "desc" });
    expect(nextSort({ key: "episodes", dir: "desc" }, "episodes")).toEqual({ key: "episodes", dir: "asc" });
  });

  it("starts a new column at its first direction", () => {
    expect(nextSort({ key: "title", dir: "asc" }, "year")).toEqual({ key: "year", dir: "desc" });
    expect(nextSort({ key: "title", dir: "asc" }, "episodes")).toEqual({ key: "episodes", dir: "asc" });
    expect(nextSort({ key: "title", dir: "asc" }, "size")).toEqual({ key: "size", dir: "desc" });
    expect(nextSort({ key: "title", dir: "asc" }, "added")).toEqual({ key: "added", dir: "desc" });
  });
});

describe("profileOptions", () => {
  it("adds an option for each orphaned profile id, labelled as the rows show it", () => {
    const options = profileOptions(SAMPLE, [{ id: 1, name: "HD-1080p" }, { id: 2, name: "Any" }]);
    expect(options).toEqual([
      { id: 1, name: "HD-1080p" },
      { id: 2, name: "Any" },
      { id: 99, name: "Unknown profile (#99)" },
    ]);
  });
});

describe("hasActiveFilters", () => {
  it("is false for the defaults and true when the missing filter is set", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, missing: "missing" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, search: "  " })).toBe(false);
  });
});

describe("paging", () => {
  it("uses 100 per page", () => {
    expect(PAGE_SIZE).toBe(100);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(100)).toBe(1);
    expect(pageCount(101)).toBe(2);
  });

  it("clamps the page number and treats non-numbers as page 1", () => {
    expect(clampPage(Number.NaN, 300)).toBe(1);
    expect(clampPage(0, 300)).toBe(1);
    expect(clampPage(9, 300)).toBe(3);
  });

  it("returns the slice for the page, clamped so a stale page is never empty", () => {
    const items = Array.from({ length: 150 }, (_, i) => i);
    expect(pageSlice(items, 2)).toHaveLength(50);
    expect(pageSlice(items, 9)[0]).toBe(100);
  });
});

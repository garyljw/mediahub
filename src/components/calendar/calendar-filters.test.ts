import { describe, expect, it } from "vitest";
import type { CalendarEntry } from "@/server/merge/calendar";
import { DEFAULT_FILTERS, entriesByDate, filterEntries, type CalendarFilters } from "./calendar-filters";

function movie(key: string, releaseType: "cinema" | "digital" | "physical", status: CalendarEntry["status"], date = "2026-11-06"): CalendarEntry {
  return {
    key,
    date,
    kind: "movie",
    title: key,
    detail: "release",
    releaseType,
    status,
    posterSrc: null,
    href: null,
  };
}

function episode(key: string, status: CalendarEntry["status"], date = "2026-11-06"): CalendarEntry {
  return {
    key,
    date,
    kind: "episode",
    title: key,
    detail: "S01E01 · Pilot",
    releaseType: null,
    status,
    posterSrc: null,
    href: "/tv/7",
  };
}

const ENTRIES: CalendarEntry[] = [
  movie("cinema-missing", "cinema", "missing"),
  movie("digital-unmonitored", "digital", "unmonitored"),
  movie("physical-downloaded", "physical", "downloaded"),
  episode("tv-missing", "missing"),
  episode("tv-unmonitored", "unmonitored"),
];

function keysOf(filters: Partial<CalendarFilters>): string[] {
  return filterEntries(ENTRIES, { ...DEFAULT_FILTERS, ...filters }).map((entry) => entry.key);
}

describe("filterEntries", () => {
  it("shows everything except unmonitored items by default", () => {
    expect(keysOf({})).toEqual(["cinema-missing", "physical-downloaded", "tv-missing"]);
  });

  it("shows unmonitored items when asked", () => {
    expect(keysOf({ showUnmonitored: true })).toEqual([
      "cinema-missing",
      "digital-unmonitored",
      "physical-downloaded",
      "tv-missing",
      "tv-unmonitored",
    ]);
  });

  it("keeps only movies or only episodes", () => {
    expect(keysOf({ type: "movies", showUnmonitored: true })).toEqual(["cinema-missing", "digital-unmonitored", "physical-downloaded"]);
    expect(keysOf({ type: "tv", showUnmonitored: true })).toEqual(["tv-missing", "tv-unmonitored"]);
  });

  it("filters movies by release type, and leaves episodes alone", () => {
    expect(keysOf({ releaseTypes: ["digital"], showUnmonitored: true })).toEqual(["digital-unmonitored", "tv-missing", "tv-unmonitored"]);
    expect(keysOf({ releaseTypes: [] })).toEqual(["tv-missing"]);
  });

  it("keeps the input order", () => {
    const reversed = [...ENTRIES].reverse();
    const kept = filterEntries(reversed, DEFAULT_FILTERS).map((entry) => entry.key);
    expect(kept).toEqual(["tv-missing", "physical-downloaded", "cinema-missing"]);
  });

  it("does not change the filters or the entries it was given", () => {
    const before = JSON.stringify(ENTRIES);
    const filters = { ...DEFAULT_FILTERS, releaseTypes: ["cinema" as const] };
    filterEntries(ENTRIES, filters);
    expect(JSON.stringify(ENTRIES)).toBe(before);
    expect(filters.releaseTypes).toEqual(["cinema"]);
  });
});

describe("entriesByDate", () => {
  it("groups entries under their date, keeping their order", () => {
    const groups = entriesByDate([
      episode("a", "missing", "2026-11-03"),
      episode("b", "missing", "2026-11-04"),
      episode("c", "upcoming", "2026-11-03"),
    ]);
    expect([...groups.keys()]).toEqual(["2026-11-03", "2026-11-04"]);
    expect(groups.get("2026-11-03")?.map((entry) => entry.key)).toEqual(["a", "c"]);
  });

  it("returns an empty map for no entries", () => {
    expect(entriesByDate([]).size).toBe(0);
  });
});

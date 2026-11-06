import "server-only";
import { describe, expect, it } from "vitest";
import { MAX_OVERVIEW, cutOverview, toPeek } from "./peek";

describe("toPeek", () => {
  it("gives the year, genres and overview of a full resource", () => {
    expect(toPeek({ year: 2026, genres: ["Drama", "Crime"], overview: "A made-up film." })).toStrictEqual({
      year: 2026,
      genres: ["Drama", "Crime"],
      overview: "A made-up film.",
    });
  });

  it("gives null for a missing or null resource", () => {
    expect(toPeek(null)).toBeNull();
    expect(toPeek(undefined)).toBeNull();
  });

  it("fills in what is missing: null year, no genres, empty overview", () => {
    expect(toPeek({ year: 2001 })).toStrictEqual({ year: 2001, genres: [], overview: "" });
    expect(toPeek({ genres: ["Drama"] })).toStrictEqual({ year: null, genres: ["Drama"], overview: "" });
    expect(toPeek({ overview: "Only this." })).toStrictEqual({ year: null, genres: [], overview: "Only this." });
  });

  it("drops a year that is not a positive integer", () => {
    expect(toPeek({ year: 0, overview: "x" })?.year).toBeNull();
    expect(toPeek({ year: -5, overview: "x" })?.year).toBeNull();
    expect(toPeek({ year: 2001.5, overview: "x" })?.year).toBeNull();
    expect(toPeek({ year: null, overview: "x" })?.year).toBeNull();
  });

  it("keeps only string genres, trimmed and non-empty", () => {
    expect(toPeek({ year: 2000, genres: [" Drama ", 7, null, "", "  ", "Crime"] as unknown as string[] })?.genres).toEqual([
      "Drama",
      "Crime",
    ]);
  });

  it("ignores genres that are not an array", () => {
    expect(toPeek({ year: 2000, genres: "Drama" as unknown as string[] })?.genres).toEqual([]);
    expect(toPeek({ year: 2000, genres: null })?.genres).toEqual([]);
  });

  it("keeps at most three genres", () => {
    expect(toPeek({ year: 2000, genres: ["A", "B", "C", "D"] })?.genres).toEqual(["A", "B", "C"]);
  });

  it("trims the overview and cuts a long one with an ellipsis", () => {
    const long = `  ${"a".repeat(MAX_OVERVIEW + 10)}  `;
    const peek = toPeek({ year: 2000, overview: long });
    expect(peek?.overview).toBe(`${"a".repeat(MAX_OVERVIEW - 1)}…`);
    expect(Array.from(peek?.overview ?? "")).toHaveLength(MAX_OVERVIEW);
  });

  it("never splits an emoji at the cut", () => {
    const overview = `${"a".repeat(MAX_OVERVIEW - 1)}🎬🎬`;
    const peek = toPeek({ year: 2000, overview });
    expect(peek?.overview).toBe(`${"a".repeat(MAX_OVERVIEW - 1)}…`);
  });

  it("returns null when there is no year, no genres and no overview", () => {
    expect(toPeek({})).toBeNull();
    expect(toPeek({ year: null, genres: [], overview: "   " })).toBeNull();
    expect(toPeek({ year: 0, genres: ["", 3 as unknown as string], overview: null })).toBeNull();
  });
});

describe("cutOverview", () => {
  it("returns text at the limit unchanged and null as an empty string", () => {
    expect(cutOverview("a".repeat(MAX_OVERVIEW))).toBe("a".repeat(MAX_OVERVIEW));
    expect(cutOverview(null)).toBe("");
    expect(cutOverview(undefined)).toBe("");
  });

  it("does not trim", () => {
    expect(cutOverview(" hi ")).toBe(" hi ");
  });
});
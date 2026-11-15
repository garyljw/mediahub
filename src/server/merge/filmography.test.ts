import "server-only";
import { describe, expect, it } from "vitest";
import type { TmdbPersonCredit } from "@/server/tmdb/schemas";
import credits from "./__fixtures__/person-credits.json";
import { ageOn, toFilmography, type Filmography } from "./filmography";

const all = credits as TmdbPersonCredit[];
const NO_LIBRARY = { movies: new Map<number, number>(), series: new Map<number, number>() };
const TODAY = "2026-11-15";
const movies = (f: Filmography) => f.tiles.filter((t) => t.kind === "movie");
const shows = (f: Filmography) => f.tiles.filter((t) => t.kind === "tv");

describe("toFilmography", () => {
  const result = toFilmography(all, NO_LIBRARY, TODAY);

  it("drops adult credits, self appearances (incl. 'Herself - Guest') and news, reality and talk shows", () => {
    expect(movies(result).map((t) => t.tmdbId)).not.toContain(5005);
    expect(movies(result).map((t) => t.tmdbId)).not.toContain(5006);
    expect(shows(result).map((t) => t.tmdbId)).toEqual([6001, 6005]);
  });

  it("merges a title that appears more than once: characters joined without repeats, the most episodes", () => {
    expect(movies(result).find((t) => t.tmdbId === 5001)).toMatchObject({
      character: "Mara / Young Mara",
      posterFile: "pHarbour.jpg",
      year: 2020,
    });
    expect(shows(result).find((t) => t.tmdbId === 6001)).toMatchObject({ character: "Dr. Okoro", episodes: 12 });
  });

  it("sorts newest first, undated last, and ties by title", () => {
    expect(movies(result).map((t) => t.title)).toEqual(["Future Tide", "Stone Garden", "Alpha Drift", "Harbour Lights", "Untitled Project"]);
    expect(shows(result).map((t) => t.title)).toEqual(["Night Ferry", "Old Signal"]);
    // All mixes the two kinds in the same order.
    expect(result.tiles.map((t) => t.title)).toEqual([
      "Future Tide",
      "Stone Garden",
      "Night Ferry",
      "Alpha Drift",
      "Harbour Lights",
      "Old Signal",
      "Untitled Project",
    ]);
  });

  it("links a library title to its own page and any other to the preview", () => {
    const withLibrary = toFilmography(all, { movies: new Map([[5002, 41]]), series: new Map([[6001, 52]]) }, TODAY);
    expect(movies(withLibrary).find((t) => t.tmdbId === 5002)).toMatchObject({ href: "/movies/41", inLibrary: true });
    expect(movies(withLibrary).find((t) => t.tmdbId === 5001)).toMatchObject({ href: "/popular/movie/5001", inLibrary: false });
    expect(shows(withLibrary).find((t) => t.tmdbId === 6001)).toMatchObject({ href: "/tv/52", inLibrary: true });
  });

  it("links every tile to the preview when the library is unknown", () => {
    const unknown = toFilmography(all, { movies: null, series: null }, TODAY);
    expect(movies(unknown).every((t) => t.href.startsWith("/popular/movie/") && !t.inLibrary)).toBe(true);
    expect(shows(unknown).every((t) => t.href.startsWith("/popular/tv/") && !t.inLibrary)).toBe(true);
  });

  it("picks the newest backdrop that is already released, skipping a future credit", () => {
    expect(result.backdropFile).toBe("bStone.jpg");
  });

  it("falls back to the newest backdrop of any date when none is released yet, then to none", () => {
    const future = all.filter((c) => c.tmdbId === 5003 || c.tmdbId === 5004);
    expect(toFilmography(future, NO_LIBRARY, TODAY).backdropFile).toBe("bFuture.jpg");
    expect(toFilmography(all.filter((c) => c.tmdbId === 5004), NO_LIBRARY, TODAY).backdropFile).toBe("bUntitled.jpg");
    expect(toFilmography(all.filter((c) => c.backdropFile === null), NO_LIBRARY, TODAY).backdropFile).toBeNull();
  });
});

describe("ageOn", () => {
  it("counts whole years, and not the next one before the birthday is reached", () => {
    expect(ageOn("1956-07-09", "2026-07-09")).toBe(70);
    expect(ageOn("1956-07-09", "2026-07-08")).toBe(69);
    expect(ageOn("1956-07-09", "2026-01-01")).toBe(69);
  });

  it.each([
    ["not a date", "2026-01-01"],
    ["1956-13-09", "2026-01-01"],
    ["1956-07-09", "soon"],
    ["2030-01-01", "2026-01-01"],
  ])("gives null for %j on %j", (birthday, on) => {
    expect(ageOn(birthday, on)).toBeNull();
  });
});

import "server-only";
import { describe, expect, it, vi } from "vitest";
import type { components as RadarrComponents } from "./generated/radarr";
import lookupFixture from "./__fixtures__/radarr-movie-lookup.json";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];
type RootFolderResource = RadarrComponents["schemas"]["RootFolderResource"];

// movie-add.ts imports the client, which imports env. Only the pure functions are tested here.
vi.mock("@/server/env", () => ({ env: () => ({}) }));

import { movieAddBody, toLookupResults, toRootFolderOptions, type MovieAdd } from "./movie-add";

const hits = lookupFixture as MovieResource[];
const LIBRARY = new Set([910005]);

describe("toLookupResults", () => {
  const results = toLookupResults(hits, LIBRARY);

  it("skips items with no positive tmdbId and items with no title", () => {
    expect(results.map((r) => r.title)).toEqual(["Lantern Harbour", "Copper Meridian", "Glass Orchard", "Signal Dust"]);
    expect(results.map((r) => r.tmdbId)).not.toContain(910003);
  });

  it("keeps upstream order", () => {
    expect(results.map((r) => r.tmdbId)).toEqual([910001, 910002, 910004, 910005]);
  });

  it("returns only the five dialog fields", () => {
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(["inLibrary", "overview", "title", "tmdbId", "year"]);
    }
  });

  it("maps a year, using null for a missing or non-positive one", () => {
    expect(results.find((r) => r.tmdbId === 910001)?.year).toBe(2021);
    expect(results.find((r) => r.tmdbId === 910005)?.year).toBeNull();
  });

  it("uses an empty overview when Radarr sends none", () => {
    expect(results.find((r) => r.tmdbId === 910002)?.overview).toBe("");
  });

  it("keeps a short overview unchanged", () => {
    expect(results.find((r) => r.tmdbId === 910001)?.overview).toBe(hits[0].overview);
  });

  it("cuts a long overview to 300 characters, ending with an ellipsis", () => {
    const orchard = results.find((r) => r.tmdbId === 910004);
    expect(orchard?.overview).toHaveLength(300);
    expect(orchard?.overview.endsWith("…")).toBe(true);
    expect(orchard?.overview.startsWith("A botanist inherits")).toBe(true);
  });

  it("marks movies already in the library", () => {
    expect(results.find((r) => r.tmdbId === 910005)?.inLibrary).toBe(true);
    expect(results.find((r) => r.tmdbId === 910001)?.inLibrary).toBe(false);
  });

  it("caps the list at 20 results, keeping the first 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ tmdbId: i + 1, title: `Film ${i + 1}` }) as MovieResource);
    const capped = toLookupResults(many, new Set());
    expect(capped).toHaveLength(20);
    expect(capped[0].tmdbId).toBe(1);
    expect(capped[19].tmdbId).toBe(20);
  });

  it("does not count skipped items toward the cap", () => {
    const mixed = [
      ...Array.from({ length: 25 }, () => ({ title: "No id" }) as MovieResource),
      ...Array.from({ length: 3 }, (_, i) => ({ tmdbId: i + 1, title: `Film ${i + 1}` }) as MovieResource),
    ];
    expect(toLookupResults(mixed, new Set())).toHaveLength(3);
  });
});

describe("toRootFolderOptions", () => {
  it("skips entries without a numeric id or a path, sorts by path, and keeps free space", () => {
    const folders: RootFolderResource[] = [
      { id: 2, path: "/invented/movies-b", freeSpace: 500 },
      { id: 3, path: "", freeSpace: 1 },
      { path: "/invented/no-id", freeSpace: 2 },
      { id: 1, path: "/invented/movies-a" },
    ];
    expect(toRootFolderOptions(folders)).toEqual([
      { id: 1, path: "/invented/movies-a", freeSpace: null },
      { id: 2, path: "/invented/movies-b", freeSpace: 500 },
    ]);
  });
});

describe("movieAddBody", () => {
  const add: MovieAdd = {
    tmdbId: 910001,
    qualityProfileId: 4,
    rootFolderPath: "/invented/movies/",
    monitored: true,
    searchForMovie: false,
  };

  it("sends exactly the fixed field set, with explicit minimumAvailability and addOptions", () => {
    expect(movieAddBody(add, "Lantern Harbour", 2021)).toStrictEqual({
      tmdbId: 910001,
      title: "Lantern Harbour",
      year: 2021,
      qualityProfileId: 4,
      rootFolderPath: "/invented/movies/",
      monitored: true,
      minimumAvailability: "released",
      addOptions: { monitor: "movieOnly", searchForMovie: false, addMethod: "manual" },
    });
  });

  it("leaves out year when it is unknown, rather than sending null", () => {
    const body = movieAddBody(add, "Signal Dust", null);
    expect("year" in body).toBe(false);
  });

  it("maps unmonitored to monitor none", () => {
    const body = movieAddBody({ ...add, monitored: false, searchForMovie: true }, "X", null);
    expect(body.monitored).toBe(false);
    expect(body.addOptions).toStrictEqual({ monitor: "none", searchForMovie: true, addMethod: "manual" });
  });
});

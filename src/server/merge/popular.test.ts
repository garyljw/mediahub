import "server-only";
import { describe, expect, it } from "vitest";
import movieList from "@/server/tmdb/__fixtures__/movie-list.json";
import movieListNulls from "@/server/tmdb/__fixtures__/movie-list-nulls.json";
import tvList from "@/server/tmdb/__fixtures__/tv-list.json";
import providersFixture from "@/server/tmdb/__fixtures__/providers.json";
import { MovieListSchema, ProvidersSchema, TvListSchema } from "@/server/tmdb/schemas";
import library from "./__fixtures__/popular-library.json";
import { chooseService, libraryByTmdbId, mergeServices, movieTiles, offeredServices, popularFilters, showTiles } from "./popular";

// The TMDB fixtures are saved live replies, run through the real parsers.
const movies = MovieListSchema.parse(movieList);
const shows = TvListSchema.parse(tvList);
const NO_GENRES = new Map<number, string>();
const DEFAULT = popularFilters([]);

describe("tiles", () => {
  it("marks a movie and a series in the library by TMDB id, with the id for the link, and leaves the rest to Add", () => {
    const movieTilesOut = movieTiles(movies, libraryByTmdbId(library.movies), NO_GENRES, DEFAULT.movieWithoutGenres);
    expect(movieTilesOut[0]).toMatchObject({ tmdbId: 1368337, kind: "movie", inLibrary: true, libraryId: 11 });
    expect(movieTilesOut.slice(1).every((t) => !t.inLibrary && t.libraryId === null)).toBe(true);

    const showTilesOut = showTiles(shows, libraryByTmdbId(library.series), NO_GENRES, DEFAULT.tvWithoutGenres);
    expect(showTilesOut[0]).toMatchObject({ tmdbId: 84773, kind: "series", inLibrary: true, libraryId: 21 });
    expect(showTilesOut[1]).toMatchObject({ inLibrary: false, libraryId: null });
  });

  it("returns only the UI's fields, with the year from the date and the poster as a bare file name", () => {
    const [first] = movieTiles(movies, new Map(), NO_GENRES, DEFAULT.movieWithoutGenres);
    expect(first).toEqual({
      tmdbId: 1368337,
      kind: "movie",
      title: "The Odyssey",
      year: 2026,
      posterFile: "5rhTDKUhPYvpdQIijFIs5VoWsON.jpg",
      peek: { year: 2026, genres: [], overview: expect.any(String) },
      inLibrary: false,
      libraryId: null,
    });
  });

  it("gives no year and no poster for a missing date and poster, and library rows without a TMDB id never match", () => {
    const parsed = MovieListSchema.parse(movieListNulls);
    expect(movieTiles(parsed, libraryByTmdbId(library.movies), NO_GENRES, DEFAULT.movieWithoutGenres)[1]).toMatchObject({ year: null, posterFile: null, inLibrary: false });
    expect(libraryByTmdbId(library.movies).size).toBe(1);
  });
});

describe("documentaries and reality shows", () => {
  it("are dropped from the tiles, whatever list they came from", () => {
    const tv = [
      { ...shows[0], id: 1, genreIds: [10764, 35] },
      { ...shows[0], id: 2, genreIds: [99] },
      { ...shows[1], genreIds: [35] },
    ];
    expect(showTiles(tv, new Map(), NO_GENRES, DEFAULT.tvWithoutGenres).map((t) => t.tmdbId)).toEqual([shows[1].id]);
    // Reality is a TV genre only: a movie with that id is kept, a documentary movie is not.
    const films = [{ ...movies[0], id: 3, genreIds: [99] }, { ...movies[1], id: 4, genreIds: [10764] }];
    expect(movieTiles(films, new Map(), NO_GENRES, DEFAULT.movieWithoutGenres).map((t) => t.tmdbId)).toEqual([4]);
  });

  it("pass through when their genre is not in the list passed", () => {
    const tv = [{ ...shows[0], id: 1, genreIds: [10764, 35] }, { ...shows[0], id: 2, genreIds: [99] }];
    const included = popularFilters(["reality"]);
    expect(showTiles(tv, new Map(), NO_GENRES, included.tvWithoutGenres).map((t) => t.tmdbId)).toEqual([1]);
  });
});

describe("popularFilters", () => {
  it.each([
    ["nothing included", [], [99], [99, 10763, 10764, 10766, 10767], [2, 4, 6]],
    ["everything included", ["documentary", "news", "reality", "soap", "talk"], [], [], [0, 1, 2, 3, 4, 5, 6]],
    ["reality and soap", ["soap", "reality"], [99], [99, 10763, 10767], [2, 3, 4, 6]],
  ] as const)("%s", (_name, include, movie, tv, types) => {
    expect(popularFilters(include)).toEqual({ movieWithoutGenres: movie, tvWithoutGenres: tv, tvTypes: types });
  });
});

describe("hover card text", () => {
  it("maps genre ids to names in order and drops unknown ids; with no genres the card still has the year and overview", () => {
    const genres = new Map([[10759, "Action & Adventure"], [18, "Drama"]]);
    // The first show has genre ids 10759 and 10765, and 10765 is not in the map.
    const [first] = showTiles(shows, new Map(), genres, DEFAULT.tvWithoutGenres);
    expect(first.peek).toEqual({ year: 2022, genres: ["Action & Adventure"], overview: expect.any(String) });
    expect(showTiles(shows, new Map(), NO_GENRES, DEFAULT.tvWithoutGenres)[0].peek.genres).toEqual([]);
  });
});

describe("services", () => {
  const providers = ProvidersSchema.parse(providersFixture);
  it("puts the most prominent services first and caps the list", () => {
    // The live fixture ranks services differently in GB than globally (Prime is 2nd in GB, 4th globally).
    expect(offeredServices(providers, "GB", []).map((p) => p.id)).toEqual([8, 9, 350, 337, 2285]);
    expect(offeredServices(providers, "ZZ", []).map((p) => p.id)).toEqual([8, 350, 337, 9, 2285]);
    const many = Array.from({ length: 20 }, (_, i) => ({ id: 1000 + i, name: `S${i}`, logoPath: null, displayPriority: 19 - i, displayPriorities: {} }));
    const top = offeredServices(many, "GB", []);
    expect(top).toHaveLength(12);
    expect(top[0].id).toBe(1019);
  });

  it("defaults to Netflix, then the first service, and takes a requested one only when offered", () => {
    const services = offeredServices(providers, "GB", []);
    expect(chooseService(services, null)?.id).toBe(8);
    expect(chooseService(services, 337)?.id).toBe(337);
    expect(chooseService(services, 4242)?.id).toBe(8);
    expect(chooseService(services.filter((p) => p.id !== 8), null)?.id).toBe(9);
    expect(chooseService([], 8)).toBeNull();
  });

  it("offers the chosen services in the chosen order and drops ids the country lacks", () => {
    expect(offeredServices(providers, "GB", [337, 4242, 8]).map((p) => p.id)).toEqual([337, 8]);
  });

  it("merges the movie and TV services, a service in both once, in ranked order", () => {
    const [netflix, ...rest] = offeredServices(providers, "GB", []);
    expect(mergeServices([netflix], [netflix, ...rest], "GB").map((p) => p.id)).toEqual(offeredServices(providers, "GB", []).map((p) => p.id));
  });

  it("starts a chosen list at its first service, not Netflix", () => {
    const chosen = offeredServices(providers, "GB", [337, 8]);
    expect(chooseService(chosen, null, false)?.id).toBe(337);
    expect(chooseService(chosen, 4242, false)?.id).toBe(337);
    expect(chooseService(chosen, 8, false)?.id).toBe(8);
  });
});

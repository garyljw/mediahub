import "server-only";
import { describe, expect, it } from "vitest";
import movieList from "@/server/tmdb/__fixtures__/movie-list.json";
import movieListNulls from "@/server/tmdb/__fixtures__/movie-list-nulls.json";
import tvList from "@/server/tmdb/__fixtures__/tv-list.json";
import providersFixture from "@/server/tmdb/__fixtures__/providers.json";
import { MovieListSchema, ProvidersSchema, TvListSchema } from "@/server/tmdb/schemas";
import library from "./__fixtures__/popular-library.json";
import { chooseService, libraryByTmdbId, movieTiles, popularServices, showTiles } from "./popular";

// The TMDB fixtures are saved live replies, run through the real parsers.
const movies = MovieListSchema.parse(movieList);
const shows = TvListSchema.parse(tvList);
const NO_GENRES = new Map<number, string>();

describe("tiles", () => {
  it("marks a movie and a series in the library by TMDB id, with the id for the link, and leaves the rest to Add", () => {
    const movieTilesOut = movieTiles(movies, libraryByTmdbId(library.movies), NO_GENRES);
    expect(movieTilesOut[0]).toMatchObject({ tmdbId: 1368337, kind: "movie", inLibrary: true, libraryId: 11 });
    expect(movieTilesOut.slice(1).every((t) => !t.inLibrary && t.libraryId === null)).toBe(true);

    const showTilesOut = showTiles(shows, libraryByTmdbId(library.series), NO_GENRES);
    expect(showTilesOut[0]).toMatchObject({ tmdbId: 84773, kind: "series", inLibrary: true, libraryId: 21 });
    expect(showTilesOut[1]).toMatchObject({ inLibrary: false, libraryId: null });
  });

  it("returns only the UI's fields, with the year from the date and the poster as a bare file name", () => {
    const [first] = movieTiles(movies, new Map(), NO_GENRES);
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
    expect(movieTiles(parsed, libraryByTmdbId(library.movies), NO_GENRES)[1]).toMatchObject({ year: null, posterFile: null, inLibrary: false });
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
    expect(showTiles(tv, new Map(), NO_GENRES).map((t) => t.tmdbId)).toEqual([shows[1].id]);
    // Reality is a TV genre only: a movie with that id is kept, a documentary movie is not.
    const films = [{ ...movies[0], id: 3, genreIds: [99] }, { ...movies[1], id: 4, genreIds: [10764] }];
    expect(movieTiles(films, new Map(), NO_GENRES).map((t) => t.tmdbId)).toEqual([4]);
  });
});

describe("hover card text", () => {
  it("maps genre ids to names in order and drops unknown ids; with no genres the card still has the year and overview", () => {
    const genres = new Map([[10759, "Action & Adventure"], [18, "Drama"]]);
    // The first show has genre ids 10759 and 10765, and 10765 is not in the map.
    const [first] = showTiles(shows, new Map(), genres);
    expect(first.peek).toEqual({ year: 2022, genres: ["Action & Adventure"], overview: expect.any(String) });
    expect(showTiles(shows, new Map(), NO_GENRES)[0].peek.genres).toEqual([]);
  });
});

describe("services", () => {
  const providers = ProvidersSchema.parse(providersFixture);
  it("puts the most prominent services first and caps the list", () => {
    // The live fixture ranks services differently in GB than globally (Prime is 2nd in GB, 4th globally).
    expect(popularServices(providers, "GB").map((p) => p.id)).toEqual([8, 9, 350, 337, 2285]);
    expect(popularServices(providers, "ZZ").map((p) => p.id)).toEqual([8, 350, 337, 9, 2285]);
    const many = Array.from({ length: 20 }, (_, i) => ({ id: 1000 + i, name: `S${i}`, logoPath: null, displayPriority: 19 - i, displayPriorities: {} }));
    const top = popularServices(many, "GB");
    expect(top).toHaveLength(12);
    expect(top[0].id).toBe(1019);
  });

  it("defaults to Netflix, then the first service, and takes a requested one only when offered", () => {
    const services = popularServices(providers, "GB");
    expect(chooseService(services, null)?.id).toBe(8);
    expect(chooseService(services, 337)?.id).toBe(337);
    expect(chooseService(services, 4242)?.id).toBe(8);
    expect(chooseService(services.filter((p) => p.id !== 8), null)?.id).toBe(9);
    expect(chooseService([], 8)).toBeNull();
  });
});

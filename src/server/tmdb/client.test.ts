import "server-only";
import { afterEach, describe, expect, it, vi } from "vitest";
import episodeCredits from "./__fixtures__/episode-credits.json";
import externalIds from "./__fixtures__/external-ids.json";
import externalIdsNull from "./__fixtures__/external-ids-null.json";
import movieList from "./__fixtures__/movie-list.json";
import movieListNulls from "./__fixtures__/movie-list-nulls.json";
import providers from "./__fixtures__/providers.json";
import regions from "./__fixtures__/regions.json";
import genresTv from "./__fixtures__/genres-tv.json";
import movieDetails from "./__fixtures__/movie-details.json";
import personDetails from "./__fixtures__/person-details.json";
import personCredits from "./__fixtures__/person-credits.json";
import tvDetails from "./__fixtures__/tv-details.json";
import tvList from "./__fixtures__/tv-list.json";
import tvListNulls from "./__fixtures__/tv-list-nulls.json";
import upcoming from "./__fixtures__/upcoming.json";
import {
  clearTmdbCache,
  discoverMovies,
  discoverShows,
  fetchRegions,
  getEpisodeCredits,
  getEpisodeTvdbId,
  getGenres,
  getMovieDetails,
  getPerson,
  getPersonCredits,
  getShowDetails,
  getProviders,
  getTrendingMovies,
  getTrendingShows,
  getTvdbId,
  getShowsOnThisWeek,
  getUpcomingMovies,
  getUpcomingShows,
  listRegions,
  TmdbRequestError,
  validateToken,
} from "./client";
import { isTmdbNotFound } from "./errors";

const TOKEN = "fake-tmdb-token-0123456789abcdef";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(handler: () => Response | Promise<Response>) {
  const mock = vi.fn<typeof fetch>(async () => handler());
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearTmdbCache();
});

describe("request", () => {
  it("sends the token as a Bearer header to the fixed host, never in the URL", async () => {
    const mock = stubFetch(() => json({ success: true }));
    await validateToken(TOKEN);
    const url = new URL(String(mock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://api.themoviedb.org/3/authentication");
    expect(url.searchParams.has("api_key")).toBe(false);
    expect(String(mock.mock.calls[0][0])).not.toContain(TOKEN);
    expect((mock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    ["a 401", () => json({ success: false, status_code: 7 }, 401), { kind: "http", status: 401 }],
    ["a 429", () => json({}, 429), { kind: "http", status: 429 }],
    ["a body that is not the expected shape", () => json({ success: false }), { kind: "invalid" }],
    ["a body that is not JSON", () => new Response("<html>", { status: 200 }), { kind: "invalid" }],
  ])("throws a TmdbRequestError for %s", async (_name, handler, expected) => {
    stubFetch(handler);
    await expect(validateToken(TOKEN)).rejects.toMatchObject({ name: "TmdbRequestError", ...expected });
  });

  it("reports a timeout and a network failure without the host, URL or token", async () => {
    stubFetch(() => {
      throw new DOMException("took too long to api.themoviedb.org", "TimeoutError");
    });
    const timeout = await validateToken(TOKEN).catch((e: unknown) => e);
    stubFetch(() => {
      throw new TypeError(`fetch failed https://api.themoviedb.org/3/authentication Bearer ${TOKEN}`);
    });
    const network = await validateToken(TOKEN).catch((e: unknown) => e);
    expect(timeout).toMatchObject({ kind: "timeout" });
    expect(network).toMatchObject({ kind: "network" });
    for (const error of [timeout, network]) {
      expect(error).toBeInstanceOf(TmdbRequestError);
      expect((error as Error).message).not.toMatch(/themoviedb|http|fake-tmdb/i);
    }
  });
});

describe("parsers", () => {
  // The fixtures are saved live replies (public catalogue data), trimmed to a few entries.
  it("keeps only the fields we use from a live movie list", async () => {
    stubFetch(() => json(movieList));
    const movies = await getTrendingMovies(TOKEN);
    expect(movies).toHaveLength(4);
    expect(movies[0]).toEqual({
      id: 1368337,
      title: "The Odyssey",
      releaseDate: "2026-07-15",
      overview: expect.any(String),
      posterPath: "/5rhTDKUhPYvpdQIijFIs5VoWsON.jpg",
      genreIds: expect.any(Array),
    });
    expect(Object.keys(movies[0]).sort()).toEqual(["genreIds", "id", "overview", "posterPath", "releaseDate", "title"]);
  });

  it("parses a live TV list and an upcoming list", async () => {
    stubFetch(() => json(tvList));
    const shows = await getTrendingShows(TOKEN);
    expect(shows[0]).toMatchObject({ id: 84773, name: "The Lord of the Rings: The Rings of Power", firstAirDate: "2022-09-01" });
    expect(Object.keys(shows[0]).sort()).toEqual(["firstAirDate", "genreIds", "id", "name", "overview", "posterPath"]);
    stubFetch(() => json(upcoming));
    expect(await getUpcomingMovies(TOKEN, "GB")).toHaveLength(3);
  });

  it("tolerates a null poster, empty poster, null overview and empty or null date", async () => {
    stubFetch(() => json(movieListNulls));
    expect((await getTrendingMovies(TOKEN))[1]).toEqual({ id: 102, title: "No Poster", releaseDate: null, overview: "", posterPath: null, genreIds: [] });
    stubFetch(() => json(tvListNulls));
    expect((await getTrendingShows(TOKEN))[1]).toEqual({ id: 202, name: "No Poster Show", firstAirDate: null, overview: "", posterPath: null, genreIds: [] });
  });

  it("keeps only id, name, logo and priority from a provider list", async () => {
    stubFetch(() => json(providers));
    const list = await getProviders(TOKEN, "movie", "GB");
    expect(list.map((p) => p.id)).toEqual([8, 9, 350, 337, 2285]);
    expect(list[1].displayPriorities.GB).toBe(2);
    expect(list[0]).toEqual({ id: 8, name: "Netflix", logoPath: "/rK1KljqmbvO9HQa1PBFLILWah72.png", displayPriority: 1, displayPriorities: expect.objectContaining({ GB: 1 }) });
  });

  it("reads genre names by id and tolerates a missing genre_ids on a title", async () => {
    stubFetch(() => json(genresTv));
    const genres = await getGenres(TOKEN, "tv");
    expect(genres.get(16)).toBe("Animation");
    expect(genres.size).toBe(5);
    stubFetch(() => json(tvListNulls));
    expect((await getTrendingShows(TOKEN))[1].genreIds).toEqual([]);
  });

  it("lists regions by name as code and name", async () => {
    stubFetch(() => json(regions));
    const list = await listRegions(TOKEN);
    expect(list).toHaveLength(5);
    expect(list[0]).toEqual({ code: "AL", name: "Albania" });
  });

  it("returns the TVDB id, or null when TMDB has none", async () => {
    stubFetch(() => json(externalIds));
    expect(await getTvdbId(TOKEN, 84773)).toBe(367506);
    stubFetch(() => json(externalIdsNull));
    expect(await getTvdbId(TOKEN, 124)).toBeNull();
    stubFetch(() => json({ tvdb_id: 0 }));
    expect(await getTvdbId(TOKEN, 125)).toBeNull();
  });

  it("leaves documentaries and Reality out of the TV discover call and documentaries out of the movie one", async () => {
    const mock = stubFetch(() => json(tvList));
    await discoverShows(TOKEN, "GB", 8, [99, 10763, 10764, 10766, 10767]);
    expect(new URL(String(mock.mock.calls[0][0])).searchParams.get("without_genres")).toBe("99,10763,10764,10766,10767");
    mock.mockImplementation(async () => json(movieList));
    await discoverMovies(TOKEN, "GB", 8, [99]);
    expect(new URL(String(mock.mock.calls[1][0])).searchParams.get("without_genres")).toBe("99");
  });

  it("omits without_genres when nothing is left out, and asks On this week for the extra show types", async () => {
    const mock = stubFetch(() => json(tvList));
    await discoverShows(TOKEN, "GB", 8, []);
    await getShowsOnThisWeek(TOKEN, "any", [], [6, 0, 2, 4]);
    const [service, week] = mock.mock.calls.map(([url]) => new URL(String(url)));
    expect(service.searchParams.has("without_genres")).toBe(false);
    expect(week.searchParams.has("without_genres")).toBe(false);
    expect(week.searchParams.get("with_type")).toBe("0|2|4|6");
  });

  it("sends the discover filters", async () => {
    const mock = stubFetch(() => json(movieList));
    await discoverMovies(TOKEN, "GB", 8, [99]);
    const params = new URL(String(mock.mock.calls[0][0])).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      watch_region: "GB",
      with_watch_providers: "8",
      with_watch_monetization_types: "flatrate",
      sort_by: "popularity.desc",
      include_adult: "false",
      without_genres: "99",
      page: "1",
    });
  });
});

describe("detail pages", () => {
  it("reads a movie's facts, directors and cast, with image paths as bare file names", async () => {
    const mock = stubFetch(() => json(movieDetails));
    const movie = await getMovieDetails(TOKEN, 1368337);
    expect(new URL(String(mock.mock.calls[0][0])).searchParams.get("append_to_response")).toBe("credits");
    expect(movie).toMatchObject({ title: "The Odyssey", runtime: 173, imdbId: "tt33764258", directors: expect.any(Array) });
    expect(movie.backdropFile).toBe("twiVn9oFXOVR0uoYgawyEBlnFu8.jpg");
    expect(movie.cast).toHaveLength(3);
    expect(movie.cast[0]).toEqual({ id: expect.any(Number), name: "Matt Damon", character: "Odysseus", episodes: null, photo: "aCvBXTAR9B1qRjIRzMBYhhbm1fR.jpg" });
  });

  it("reads a show's facts and cast, and takes the episode length from the last episode when TMDB has none", async () => {
    stubFetch(() => json(tvDetails));
    const show = await getShowDetails(TOKEN, 84773);
    expect(show).toMatchObject({ name: "The Lord of the Rings: The Rings of Power", seasons: 3, runtime: 57, status: "Returning Series" });
    expect(show.createdBy).toEqual(["Patrick McKay", "John D. Payne"]);
    expect(show.networks).toEqual(["Prime Video"]);
    expect(show.cast[0]).toMatchObject({ name: "Charlie Vickers", episodes: 24, character: expect.any(String) });
    clearTmdbCache();
    stubFetch(() => json({ ...tvDetails, episode_run_time: [45], tagline: "", genres: null }));
    expect(await getShowDetails(TOKEN, 84773)).toMatchObject({ runtime: 45, tagline: null, genres: [] });
    clearTmdbCache();
    stubFetch(() => json({ ...tvDetails, episode_run_time: [], last_episode_to_air: { runtime: null } }));
    expect((await getShowDetails(TOKEN, 84773)).runtime).toBeNull();
  });

  // TMDB sends 0 for figures it doesn't know yet (seen live on an unreleased film's runtime). The page must still load.
  it("reads a 0 runtime, season or episode count as unknown instead of refusing the reply", async () => {
    stubFetch(() => json({ ...movieDetails, runtime: 0 }));
    expect((await getMovieDetails(TOKEN, 1368337)).runtime).toBeNull();
    stubFetch(() =>
      json({ ...tvDetails, number_of_seasons: 0, number_of_episodes: 0, episode_run_time: [], last_episode_to_air: { runtime: 0 } }),
    );
    expect(await getShowDetails(TOKEN, 84773)).toMatchObject({ seasons: null, episodes: null, runtime: null });
  });
});

describe("episode credits", () => {
  it("lists the regulars, then the guests, each in order, without duplicates, bad ids or crew", async () => {
    stubFetch(() => json(episodeCredits));
    expect(await getEpisodeCredits(TOKEN, 84773, 1, 2)).toEqual([
      { id: 900101, name: "Ana Example", character: "Captain Test", episodes: null, photo: "abcAnaProfile123.jpg" },
      { id: 900102, name: "Ben Sample", character: "Mate Fake", episodes: null, photo: "abcBenProfile123.jpg" },
      { id: 900201, name: "Cy Guest", character: "Harbour Master", episodes: null, photo: null },
      { id: 900202, name: "Di Guest", character: null, episodes: null, photo: "abcDiProfile123.jpg" },
    ]);
  });

  it("asks for the English reply at the episode's credits path, and reports a missing episode as a not-found error", async () => {
    const mock = stubFetch(() => json(episodeCredits));
    await getEpisodeCredits(TOKEN, 84773, 0, 5);
    const url = new URL(String(mock.mock.calls[0][0]));
    expect(url.pathname).toBe("/3/tv/84773/season/0/episode/5/credits");
    expect(url.searchParams.get("language")).toBe("en-US");
    clearTmdbCache();
    stubFetch(() => json({ success: false, status_code: 34 }, 404));
    const error = await getEpisodeCredits(TOKEN, 84773, 9, 9).catch((e: unknown) => e);
    expect(isTmdbNotFound(error)).toBe(true);
  });
});

describe("episode external ids", () => {
  it("asks for the episode's external ids and returns its TVDB id", async () => {
    const mock = stubFetch(() => json({ id: 1, imdb_id: "tt0000001", tvdb_id: 7700123 }));
    expect(await getEpisodeTvdbId(TOKEN, 84773, 2, 3)).toBe(7700123);
    const url = new URL(String(mock.mock.calls[0][0]));
    expect(url.pathname).toBe("/3/tv/84773/season/2/episode/3/external_ids");
    expect(url.search).toBe("");
  });
});

describe("person pages", () => {
  it("reads a person's details, asking for the English reply with the token only in the header", async () => {
    const mock = stubFetch(() => json(personDetails));
    const person = await getPerson(TOKEN, 900001);
    const url = new URL(String(mock.mock.calls[0][0]));
    expect(url.pathname).toBe("/3/person/900001");
    expect(url.searchParams.get("language")).toBe("en-US");
    expect(String(mock.mock.calls[0][0])).not.toContain(TOKEN);
    expect((mock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(person).toEqual({
      id: 900001,
      name: "Mira Tester",
      biography: "Mira Tester is a made-up actor.\n\nShe was born in a town that does not exist.",
      birthday: "1976-07-09",
      deathday: null,
      placeOfBirth: "Faketown, Exampleland",
      knownFor: "Acting",
      imdbId: "nm0000001",
      photoFile: "abcTesterProfile123.jpg",
    });
  });

  it("turns a bad IMDb id, bad dates, empty strings and a bad photo path into null", async () => {
    stubFetch(() =>
      json({ ...personDetails, imdb_id: "tt123", birthday: "1976", deathday: "", place_of_birth: "", known_for_department: "", biography: null, profile_path: "/../x.png" }),
    );
    expect(await getPerson(TOKEN, 900001)).toMatchObject({
      imdbId: null,
      birthday: null,
      deathday: null,
      placeOfBirth: null,
      knownFor: null,
      biography: "",
      photoFile: null,
    });
  });

  it("reads the cast credits and drops an item with an unknown media type or no title without failing the rest", async () => {
    const mock = stubFetch(() => json(personCredits));
    const credits = await getPersonCredits(TOKEN, 900001);
    const url = new URL(String(mock.mock.calls[0][0]));
    expect(url.pathname).toBe("/3/person/900001/combined_credits");
    expect(url.searchParams.get("language")).toBe("en-US");
    expect(credits).toEqual([
      {
        kind: "movie",
        tmdbId: 700001,
        title: "Fake Movie One",
        date: "2021-05-20",
        character: "Dana",
        episodes: null,
        posterFile: "pFakeMovie1.jpg",
        backdropFile: "bdFakeMovie1.jpg",
        genreIds: [18, 35],
        adult: false,
      },
      {
        kind: "tv",
        tmdbId: 800001,
        title: "Fake Show One",
        date: "2019-04-02",
        character: null,
        episodes: 14,
        posterFile: null,
        backdropFile: null,
        genreIds: [18],
        adult: false,
      },
      {
        kind: "tv",
        tmdbId: 800002,
        title: "Fake Show Two",
        date: "2016-02-03",
        character: "Eli",
        episodes: 3,
        posterFile: null,
        backdropFile: null,
        genreIds: [],
        adult: false,
      },
    ]);
  });

  it("reads a reply with no cast as no credits", async () => {
    stubFetch(() => json({ id: 900001 }));
    expect(await getPersonCredits(TOKEN, 900001)).toEqual([]);
  });

  it("surfaces an unknown person as a TmdbRequestError with status 404", async () => {
    stubFetch(() => json({ status_code: 34 }, 404));
    await expect(getPerson(TOKEN, 1)).rejects.toMatchObject({ name: "TmdbRequestError", kind: "http", status: 404 });
  });
});

describe("TV windows", () => {
  it("sends the date window, filters and original language, and leaves the language out for any", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T23:30:00Z"));
    try {
      const mock = stubFetch(() => json(tvList));
      await getUpcomingShows(TOKEN, "ja", [99, 10763, 10764, 10766, 10767]);
      await getShowsOnThisWeek(TOKEN, "any", [99, 10763, 10764, 10766, 10767], [2, 4, 6]);
      const [upcoming, week] = mock.mock.calls.map(([url]) => new URL(String(url)));
      expect(upcoming.pathname).toBe("/3/discover/tv");
      expect(Object.fromEntries(upcoming.searchParams)).toEqual({
        "first_air_date.gte": "2026-11-14",
        "first_air_date.lte": "2026-12-12",
        sort_by: "popularity.desc",
        include_adult: "false",
        include_null_first_air_dates: "false",
        without_genres: "99,10763,10764,10766,10767",
        with_original_language: "ja",
        language: "en-US",
        page: "1",
      });
      expect(week.pathname).toBe("/3/discover/tv");
      expect(Object.fromEntries(week.searchParams)).toEqual({
        "air_date.gte": "2026-11-14",
        "air_date.lte": "2026-11-21",
        with_type: "2|4|6",
        without_genres: "99,10763,10764,10766,10767",
        sort_by: "popularity.desc",
        include_adult: "false",
        language: "en-US",
        page: "1",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cache", () => {
  it("shares one request between concurrent calls and serves repeats from memory until cleared", async () => {
    const mock = stubFetch(() => json(movieList));
    await Promise.all([getTrendingMovies(TOKEN), getTrendingMovies(TOKEN)]);
    await getTrendingMovies(TOKEN);
    expect(mock).toHaveBeenCalledTimes(1);
    clearTmdbCache();
    await getTrendingMovies(TOKEN);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("keeps a separate entry per token", async () => {
    const mock = stubFetch(() => json(movieList));
    await getTrendingMovies(TOKEN);
    await getTrendingMovies("another-fake-token-0123456789");
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("caches a failure for 60 seconds, then tries again", async () => {
    vi.useFakeTimers();
    try {
      const mock = stubFetch(() => json({}, 429));
      await expect(getTrendingMovies(TOKEN)).rejects.toBeInstanceOf(TmdbRequestError);
      await expect(getTrendingMovies(TOKEN)).rejects.toBeInstanceOf(TmdbRequestError);
      expect(mock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(61_000);
      mock.mockImplementation(async () => json(movieList));
      await getTrendingMovies(TOKEN);
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a load that was in flight when the cache was cleared fill the cache", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const mock = stubFetch(async () => {
      await gate;
      return json(movieList);
    });
    const inFlight = getTrendingMovies(TOKEN);
    clearTmdbCache();
    release();
    await inFlight;
    await getTrendingMovies(TOKEN);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("keeps a TVDB id for a day, but never a failed lookup or a missing id", async () => {
    vi.useFakeTimers();
    try {
      const mock = stubFetch(() => json(externalIds));
      await getTvdbId(TOKEN, 84773);
      vi.advanceTimersByTime(23 * 3600_000);
      await getTvdbId(TOKEN, 84773);
      expect(mock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2 * 3600_000);
      await getTvdbId(TOKEN, 84773);
      expect(mock).toHaveBeenCalledTimes(2);
      mock.mockImplementation(async () => json({}, 429));
      await expect(getTvdbId(TOKEN, 1)).rejects.toBeInstanceOf(TmdbRequestError);
      mock.mockImplementation(async () => json(externalIds));
      await getTvdbId(TOKEN, 1);
      expect(mock).toHaveBeenCalledTimes(4);
      mock.mockImplementation(async () => json(externalIdsNull));
      expect(await getTvdbId(TOKEN, 2)).toBeNull();
      mock.mockImplementation(async () => json(externalIds));
      expect(await getTvdbId(TOKEN, 2)).toBe(367506);
      expect(mock).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks a country list for an unsaved token without touching the cache", async () => {
    const mock = stubFetch(() => json({}, 401));
    await expect(fetchRegions("new-unsaved-token")).rejects.toBeInstanceOf(TmdbRequestError);
    mock.mockImplementation(async () => json(regions));
    expect(await listRegions(TOKEN)).toHaveLength(5);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("caps the cache at 500 entries, dropping the oldest first", async () => {
    vi.useFakeTimers();
    try {
      const mock = stubFetch(() => json(providers));
      await getProviders(TOKEN, "movie", "R0");
      await getProviders(TOKEN, "movie", "R0");
      expect(mock).toHaveBeenCalledTimes(1);
      for (let i = 1; i <= 500; i++) await getProviders(TOKEN, "movie", `R${i}`);
      // R0 was the oldest, so the cap pushed it out.
      await getProviders(TOKEN, "movie", "R0");
      expect(mock).toHaveBeenCalledTimes(502);
    } finally {
      vi.useRealTimers();
    }
  });
});

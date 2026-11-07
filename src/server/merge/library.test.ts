import "server-only";
import { describe, expect, it } from "vitest";
import type { MovieRow } from "@/server/arr/movies";
import type { SeriesRow } from "@/server/arr/series";
import { STATUS_CLASS as MOVIE_STATUS_CLASS, STATUS_LABEL as MOVIE_STATUS_LABEL } from "@/components/movies/movie-status";
import { EPISODE_STATUS_CLASS } from "@/components/tv/series-status";
import moviesFixture from "./__fixtures__/home-movies.json";
import seriesFixture from "./__fixtures__/home-series.json";
import { homeWatched, homeWatchedByKey, toHomeItems } from "./library";
import type { WatchedIndex } from "./watched";

// The fixtures are already-reduced rows (the shape listMovies and listSeries return), so they are cast rather than inferred.
const movies = moviesFixture as MovieRow[];
const series = seriesFixture as SeriesRow[];

const items = toHomeItems(movies, series, null);
const byKey = (key: string) => {
  const item = items.find((entry) => entry.key === key);
  if (!item) throw new Error(`no item ${key}`);
  return item;
};

describe("toHomeItems: kinds, keys and hrefs", () => {
  it("keeps every movie and series", () => {
    expect(items).toHaveLength(movies.length + series.length);
    expect(items.filter((item) => item.kind === "movie")).toHaveLength(movies.length);
    expect(items.filter((item) => item.kind === "series")).toHaveLength(series.length);
  });

  it("keys movies and series apart, even when the ids match", () => {
    // Movie 4 and series 4 are both "Glass Orchard".
    expect(byKey("movie:4")).toMatchObject({ kind: "movie", id: 4, href: "/movies/4" });
    expect(byKey("series:4")).toMatchObject({ kind: "series", id: 4, href: "/tv/4" });
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });

  it("links movies to /movies/[id] and series to /tv/[id]", () => {
    expect(byKey("movie:1").href).toBe("/movies/1");
    expect(byKey("series:5").href).toBe("/tv/5");
  });

  it("copies the title, year and sort fields", () => {
    expect(byKey("movie:3")).toMatchObject({ title: "Future Tense", year: 2027, sortTitle: "future tense" });
    expect(byKey("movie:4").year).toBeNull();
  });
});

describe("toHomeItems: poster routes", () => {
  it("points at the poster route only when the row has a poster", () => {
    expect(byKey("movie:1").posterSrc).toBe("/api/movies/1/poster");
    expect(byKey("series:4").posterSrc).toBe("/api/tv/4/poster");
  });

  it("gives null when there is no poster", () => {
    expect(byKey("movie:2").posterSrc).toBeNull();
    expect(byKey("series:5").posterSrc).toBeNull();
  });
});

describe("toHomeItems: badges", () => {
  it("labels a movie with its status, in the Movies colours", () => {
    expect(byKey("movie:1").badge).toEqual({
      label: MOVIE_STATUS_LABEL.downloaded,
      className: MOVIE_STATUS_CLASS.downloaded,
    });
    expect(byKey("movie:2").badge).toEqual({ label: MOVIE_STATUS_LABEL.missing, className: MOVIE_STATUS_CLASS.missing });
    expect(byKey("movie:3").badge).toEqual({
      label: MOVIE_STATUS_LABEL.unreleased,
      className: MOVIE_STATUS_CLASS.unreleased,
    });
  });

  it("shows a series expecting no episodes as 0/0, muted", () => {
    expect(byKey("series:6").badge).toEqual({ label: "0/0 episodes", className: EPISODE_STATUS_CLASS.unaired });
  });

  it("shows a complete series in the downloaded colour", () => {
    expect(byKey("series:4").badge).toEqual({ label: "8/8 episodes", className: EPISODE_STATUS_CLASS.downloaded });
  });

  it("shows an incomplete series in the missing colour", () => {
    expect(byKey("series:5").badge).toEqual({ label: "3/10 episodes", className: EPISODE_STATUS_CLASS.missing });
    expect(byKey("series:7").badge).toEqual({ label: "0/4 episodes", className: EPISODE_STATUS_CLASS.missing });
  });

  it("formats large episode counts with commas", () => {
    expect(byKey("series:8").badge.label).toBe("1,200/1,234 episodes");
  });
});

describe("toHomeItems: ordering", () => {
  it("sorts A–Z by sort title, movies and series together", () => {
    expect(items.map((item) => item.key)).toEqual([
      "movie:3",
      "movie:4",
      "series:4",
      "movie:1",
      "series:8",
      "movie:2",
      "series:5",
      "series:6",
      "series:7",
    ]);
  });

  it("puts a movie before a series when they share a sort title", () => {
    const [, second, third] = items;
    expect(second.key).toBe("movie:4");
    expect(third.key).toBe("series:4");
    expect(second.sortTitle).toBe(third.sortTitle);
  });
});

describe("toHomeItems: Plex watched state", () => {
  const watched: WatchedIndex = {
    movies: new Map([
      [900001, "watched"],
      [900002, "partial"],
      [900003, "unwatched"],
    ]),
    series: new Map([
      [100004, "watched"],
      [100005, "partial"],
      [100006, "unwatched"],
      [100008, "partial"],
    ]),
    showKeys: new Map(),
    itemKeys: { movie: new Map(), series: new Map() },
  };
  const withPlex = toHomeItems(movies, series, watched);

  it("gives every item null when there is no index (Plex not connected or failed)", () => {
    expect(items.every((item) => item.watched === null)).toBe(true);
  });

  it("gives each matched movie and series its state, by tmdb and tvdb id", () => {
    const pick = (key: string) => withPlex.find((item) => item.key === key)?.watched;
    expect(pick("movie:1")).toBe("watched");
    expect(pick("movie:2")).toBe("partial");
    expect(pick("movie:3")).toBe("unwatched");
    expect(pick("series:5")).toBe("partial");
    expect(pick("series:6")).toBe("unwatched");
    expect(pick("series:8")).toBe("partial");
  });

  it("gives null to a title not in Plex, and to a row with no upstream id", () => {
    const pick = (key: string) => withPlex.find((item) => item.key === key)?.watched;
    expect(pick("movie:4")).toBeNull();
    expect(pick("series:7")).toBeNull();
    expect(pick("series:4")).toBe("watched");
  });

  it("never matches a movie id against a series, or the reverse", () => {
    // Movie 4 and series 4 share an id number. Only the tmdb/tvdb ids are looked up, so neither picks up the other's state.
    const onlyMovies: WatchedIndex = {
      movies: new Map(),
      series: new Map([[4, "watched"]]),
      showKeys: new Map(),
      itemKeys: { movie: new Map(), series: new Map() },
    };
    const result = toHomeItems(movies, series, onlyMovies);
    expect(result.find((item) => item.key === "movie:4")?.watched).toBeNull();
    expect(result.find((item) => item.key === "series:4")?.watched).toBeNull();
  });

  it("keeps the id fields out of the items", () => {
    for (const item of withPlex) {
      expect(Object.keys(item)).not.toContain("tmdbId");
      expect(Object.keys(item)).not.toContain("tvdbId");
    }
  });
});

describe("toHomeItems: Focus membership", () => {
  it("marks a series only from the series list, even when a movie has the same number", () => {
    const sharedId = series[0].id;
    const result = toHomeItems(movies, series, null, { movie: new Set([sharedId]), series: new Set() });
    expect(result.some((item) => item.kind === "series" && item.id === sharedId)).toBe(true);
    expect(result.filter((item) => item.inFocus).every((item) => item.kind === "movie")).toBe(true);
    expect(result.filter((item) => item.inFocus).length).toBe(movies.filter((movie) => movie.id === sharedId).length);
  });

  it("is false for everything when no membership is given", () => {
    expect(items.every((item) => item.inFocus === false)).toBe(true);
  });
});

describe("toHomeItems: on disk", () => {
  const movieWith = (status: MovieRow["status"]) => toHomeItems([{ ...movies[0], status }], [], null)[0];
  const seriesWith = (episodeFileCount: number) =>
    toHomeItems([], [{ ...series[0], episodeFileCount }], null)[0];

  it("is true for a downloaded movie and false for a missing or unreleased one", () => {
    expect(movieWith("downloaded").onDisk).toBe(true);
    expect(movieWith("missing").onDisk).toBe(false);
    expect(movieWith("unreleased").onDisk).toBe(false);
  });

  it("is false for a series with no episode files", () => {
    expect(seriesWith(0).onDisk).toBe(false);
  });

  it("is true for a series with at least one episode file, even when incomplete", () => {
    expect(seriesWith(1).onDisk).toBe(true);
    expect(seriesWith(3).onDisk).toBe(true);
  });
});

describe("homeWatchedByKey", () => {
  const index: WatchedIndex = {
    movies: new Map([
      [900001, "watched"],
      [900003, "unwatched"],
    ]),
    series: new Map([
      [100004, "partial"],
      [100006, "unwatched"],
    ]),
    showKeys: new Map(),
    itemKeys: { movie: new Map(), series: new Map() },
  };

  it("keys each matched item the way toHomeItems does, with its state", () => {
    expect(homeWatchedByKey(movies, series, index)).toEqual({
      "movie:1": "watched",
      "movie:3": "unwatched",
      "series:4": "partial",
      "series:6": "unwatched",
    });
  });

  it("leaves out rows with no match, and rows with no upstream id", () => {
    const byKey = homeWatchedByKey(movies, series, index);
    expect(byKey).not.toHaveProperty("movie:2");
    expect(byKey).not.toHaveProperty("movie:4");
    expect(byKey).not.toHaveProperty("series:5");
    expect(byKey).not.toHaveProperty("series:7");
  });

  it("gives an empty map when no row matches", () => {
    expect(homeWatchedByKey(movies, series, { ...index, movies: new Map(), series: new Map() })).toEqual({});
  });

  it("agrees with toHomeItems on every item it names", () => {
    const byKey = homeWatchedByKey(movies, series, index);
    const merged = toHomeItems(movies, series, index);
    for (const item of merged) {
      expect(item.watched).toBe(byKey[item.key] ?? null);
    }
  });
});

describe("homeWatched", () => {
  const index: WatchedIndex = {
    movies: new Map([[900001, "watched"]]),
    series: new Map(),
    showKeys: new Map(),
    itemKeys: { movie: new Map(), series: new Map() },
  };

  it("is failed when Plex failed", () => {
    expect(homeWatched(movies, series, "failed")).toEqual({ state: "failed" });
  });

  it("is none when no Plex data connection is set up", () => {
    expect(homeWatched(movies, series, null)).toEqual({ state: "none" });
  });

  it("is ready with the matched states otherwise", () => {
    expect(homeWatched(movies, series, index)).toEqual({ state: "ready", byKey: { "movie:1": "watched" } });
  });
});

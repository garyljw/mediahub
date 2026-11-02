import "server-only";
import { describe, expect, it } from "vitest";
import type { MovieRow } from "@/server/arr/movies";
import type { SeriesRow } from "@/server/arr/series";
import { STATUS_CLASS as MOVIE_STATUS_CLASS, STATUS_LABEL as MOVIE_STATUS_LABEL } from "@/components/movies/movie-status";
import { EPISODE_STATUS_CLASS } from "@/components/tv/series-status";
import moviesFixture from "./__fixtures__/home-movies.json";
import seriesFixture from "./__fixtures__/home-series.json";
import { toHomeItems } from "./library";

// The fixtures are already-reduced rows (the shape listMovies and listSeries return), so they are cast rather than inferred.
const movies = moviesFixture as MovieRow[];
const series = seriesFixture as SeriesRow[];

const items = toHomeItems(movies, series);
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
  it("sorts newest added first, with missing dates last and ties by title", () => {
    expect(items.map((item) => item.key)).toEqual([
      "movie:4",
      "series:4",
      "series:5",
      "movie:1",
      "movie:2",
      "series:8",
      "series:7",
      "movie:3",
      "series:6",
    ]);
  });

  it("puts a movie before a series when they share a date and title", () => {
    const [first, second] = items;
    expect(first.key).toBe("movie:4");
    expect(second.key).toBe("series:4");
    expect(first.added).toBe(second.added);
  });

  it("orders items with no date by title", () => {
    const undated = items.filter((item) => item.added === null);
    expect(undated.map((item) => item.title)).toEqual(["Future Tense", "Quiet Hills"]);
  });
});

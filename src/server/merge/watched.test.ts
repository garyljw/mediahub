import "server-only";
import { describe, expect, it, vi } from "vitest";
import { SectionItemsSchema, type PlexSectionItem } from "@/server/plex/server";
import movieSection from "./__fixtures__/plex-movie-section.json";
import showSection from "./__fixtures__/plex-show-section.json";
import { movieWatchedState, showWatchedState, toWatchedIndex } from "./watched";

vi.mock("@/server/plex/data-connection", () => ({ getPlexDataClientId: () => "mediahub-data-fake-client-id" }));

// The fixtures go through the same schema the live client uses, so the field stripping is exercised too.
const movieItems = SectionItemsSchema.parse(movieSection);
const showItems = SectionItemsSchema.parse(showSection);

const item = (overrides: Partial<PlexSectionItem> = {}): PlexSectionItem => ({
  guids: [],
  viewCount: 0,
  viewOffset: 0,
  leafCount: 0,
  viewedLeafCount: 0,
  ...overrides,
});

describe("the schema keeps only the watched-status fields", () => {
  it("drops titles, rating keys and durations from each item", () => {
    expect(movieItems[0]).toEqual({
      guids: ["imdb://tt0000001", "tmdb://900001", "tvdb://0"],
      viewCount: 1,
      viewOffset: 0,
      leafCount: 0,
      viewedLeafCount: 0,
    });
    expect(JSON.stringify(movieItems)).not.toContain("Fake Watched Film");
    expect(JSON.stringify(movieItems)).not.toContain("ratingKey");
  });
});

describe("movieWatchedState", () => {
  it("is watched once viewed, partial once started, unwatched otherwise", () => {
    expect(movieWatchedState(item({ viewCount: 2, viewOffset: 500 }))).toBe("watched");
    expect(movieWatchedState(item({ viewOffset: 120000 }))).toBe("partial");
    expect(movieWatchedState(item())).toBe("unwatched");
  });
});

describe("showWatchedState", () => {
  it("is watched when every episode is viewed", () => {
    expect(showWatchedState(item({ leafCount: 10, viewedLeafCount: 10 }))).toBe("watched");
  });

  it("is partial when some episodes are viewed", () => {
    expect(showWatchedState(item({ leafCount: 10, viewedLeafCount: 3 }))).toBe("partial");
  });

  it("is unwatched when no episodes are viewed", () => {
    expect(showWatchedState(item({ leafCount: 8, viewedLeafCount: 0 }))).toBe("unwatched");
  });

  it("has no state for a show with no episodes", () => {
    expect(showWatchedState(item({ leafCount: 0, viewedLeafCount: 0 }))).toBeNull();
  });
});

describe("toWatchedIndex: movies", () => {
  const { movies } = toWatchedIndex(movieItems, []);

  it("maps each tmdb id to its state", () => {
    expect(movies.get(900001)).toBe("watched");
    expect(movies.get(900003)).toBe("unwatched");
  });

  it("maps a started movie to partial", () => {
    expect(movies.get(900002)).toBe("partial");
  });

  it("skips an item with only an imdb guid, or no guid at all", () => {
    expect(movies.has(4)).toBe(false);
    expect(movies.size).toBe(3);
  });

  it("ignores a zero or non-numeric tmdb id", () => {
    expect([...movies.keys()]).not.toContain(0);
    expect(movies.size).toBe(3);
  });

  it("keeps the most watched state when an id is in two items", () => {
    expect(movies.get(900002)).toBe("partial");
  });

  it("keeps the most watched state whichever item comes first", () => {
    const reversed = toWatchedIndex([...movieItems].reverse(), []);
    expect(reversed.movies.get(900002)).toBe("partial");
  });

  it("indexes an item under every tmdb id it lists", () => {
    const merged = toWatchedIndex([item({ guids: ["tmdb://700001", "tmdb://700002"], viewCount: 1 })], []);
    expect(merged.movies.get(700001)).toBe("watched");
    expect(merged.movies.get(700002)).toBe("watched");
  });

  it("uses only tmdb guids for movies, never tvdb", () => {
    const onlyTvdb = toWatchedIndex([item({ guids: ["tvdb://100001"], viewCount: 1 })], []);
    expect(onlyTvdb.movies.size).toBe(0);
    expect(onlyTvdb.series.size).toBe(0);
  });
});

describe("toWatchedIndex: shows", () => {
  const { series } = toWatchedIndex([], showItems);

  it("maps each tvdb id to its state", () => {
    expect(series.get(100001)).toBe("watched");
    expect(series.get(100002)).toBe("partial");
  });

  it("maps a show with no episodes watched to unwatched when it is listed alone", () => {
    expect(toWatchedIndex([], [item({ guids: ["tvdb://100009"], leafCount: 8 })]).series.get(100009)).toBe("unwatched");
  });

  it("skips a show with no episodes", () => {
    expect(series.has(100004)).toBe(false);
  });

  it("skips a show with only a tmdb guid", () => {
    expect(series.has(800002)).toBe(false);
    expect(series.size).toBe(3);
  });

  it("keeps the most watched state when a show is in two libraries", () => {
    // tvdb 100003 is unwatched in one library and partly watched in another.
    expect(series.get(100003)).toBe("partial");
  });

  it("uses only tvdb guids for shows, never tmdb", () => {
    const onlyTmdb = toWatchedIndex([], [item({ guids: ["tmdb://800001"], leafCount: 1, viewedLeafCount: 1 })]);
    expect(onlyTmdb.series.size).toBe(0);
  });
});

describe("toWatchedIndex: empty input", () => {
  it("gives empty maps for empty sections", () => {
    const index = toWatchedIndex([], []);
    expect(index.movies.size).toBe(0);
    expect(index.series.size).toBe(0);
  });
});

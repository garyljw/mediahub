import "server-only";
import { describe, expect, it, vi } from "vitest";
import { EpisodeItemsSchema, SectionItemsSchema, type PlexSectionItem } from "@/server/plex/server";
import movieSection from "./__fixtures__/plex-movie-section.json";
import showSection from "./__fixtures__/plex-show-section.json";
import episodeSection from "./__fixtures__/plex-show-episodes.json";
import {
  episodeWatchedState,
  movieWatchedState,
  seasonWatchedState,
  showWatchedState,
  toEpisodeWatched,
  toWatchedIndex,
  type EpisodeRef,
} from "./watched";

vi.mock("@/server/plex/data-connection", () => ({ getPlexDataClientId: () => "mediahub-data-fake-client-id" }));

// The fixtures go through the same schema the live client uses, so the field stripping is exercised too.
const movieItems = SectionItemsSchema.parse(movieSection);
const showItems = SectionItemsSchema.parse(showSection);
const episodeItems = EpisodeItemsSchema.parse(episodeSection);

const item = (overrides: Partial<PlexSectionItem> = {}): PlexSectionItem => ({
  guids: [],
  viewCount: 0,
  viewOffset: 0,
  leafCount: 0,
  viewedLeafCount: 0,
  ratingKey: null,
  ...overrides,
});

describe("the schema keeps only the watched-status fields", () => {
  it("drops titles, media and durations from each item, and keeps the rating key", () => {
    expect(movieItems[0]).toEqual({
      guids: ["imdb://tt0000001", "tmdb://900001", "tvdb://0"],
      viewCount: 1,
      viewOffset: 0,
      leafCount: 0,
      viewedLeafCount: 0,
      ratingKey: "1001",
    });
    expect(JSON.stringify(movieItems)).not.toContain("Fake Watched Film");
    expect(JSON.stringify(movieItems)).not.toContain("duration");
  });

  it("drops titles, media and file paths from each episode, and keeps only the numbers and counts", () => {
    expect(episodeItems[0]).toEqual({
      guids: ["tvdb://200001", "tmdb://400001", "imdb://tt0000201"],
      season: 1,
      episode: 1,
      viewCount: 1,
      viewOffset: 0,
    });
    expect(JSON.stringify(episodeItems)).not.toContain("Fake Pilot");
    expect(JSON.stringify(episodeItems)).not.toContain("Media");
    expect(JSON.stringify(episodeItems)).not.toContain("fake/path");
  });
});

describe("episodeWatchedState", () => {
  it("is watched once viewed, partly watched once started, unwatched otherwise", () => {
    expect(episodeWatchedState(episodeItems[0])).toBe("watched");
    expect(episodeWatchedState(episodeItems[1])).toBe("partial");
    expect(episodeWatchedState(episodeItems[2])).toBe("unwatched");
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
    expect(index.showKeys.size).toBe(0);
  });
});

describe("toWatchedIndex: show keys", () => {
  it("lists the rating key of every show that has each tvdb id, across libraries", () => {
    const shows = [
      item({ guids: ["tvdb://300001"], leafCount: 4, viewedLeafCount: 1, ratingKey: "5001" }),
      item({ guids: ["tvdb://300001"], leafCount: 4, viewedLeafCount: 4, ratingKey: "5002" }),
    ];
    const index = toWatchedIndex([], shows);
    expect(index.showKeys.get(300001)).toEqual(["5001", "5002"]);
    expect(index.series.get(300001)).toBe("watched");
  });

  it("does not list the same rating key twice", () => {
    const twice = [
      item({ guids: ["tvdb://300002"], leafCount: 4, viewedLeafCount: 1, ratingKey: "5003" }),
      item({ guids: ["tvdb://300002"], leafCount: 4, viewedLeafCount: 1, ratingKey: "5003" }),
    ];
    expect(toWatchedIndex([], twice).showKeys.get(300002)).toEqual(["5003"]);
  });

  it("skips a show with no rating key, but keeps its watched state", () => {
    const index = toWatchedIndex([], [item({ guids: ["tvdb://300003"], leafCount: 4, viewedLeafCount: 2, ratingKey: null })]);
    expect(index.series.get(300003)).toBe("partial");
    expect(index.showKeys.has(300003)).toBe(false);
  });

  it("records no key for a show with no episodes", () => {
    const index = toWatchedIndex([], [item({ guids: ["tvdb://300004"], leafCount: 0, ratingKey: "5004" })]);
    expect(index.showKeys.has(300004)).toBe(false);
  });

  it("reads the rating key from the show fixture", () => {
    const { showKeys } = toWatchedIndex([], showItems);
    expect(showKeys.get(100001)).toEqual(["2001"]);
    expect(showKeys.has(100004)).toBe(false);
  });
});

describe("toEpisodeWatched", () => {
  // Sonarr episodes. Each comment says how the row should match the Plex fixture (plex-show-episodes.json).
  const episodes: EpisodeRef[] = [
    { id: 1, tvdbId: 200001, seasonNumber: 1, episodeNumber: 1 }, // matched by TVDB id: watched
    { id: 2, tvdbId: 200002, seasonNumber: 1, episodeNumber: 2 }, // matched by TVDB id: partly watched
    { id: 3, tvdbId: 200003, seasonNumber: 1, episodeNumber: 3 }, // matched by TVDB id: unwatched
    { id: 4, tvdbId: null, seasonNumber: 1, episodeNumber: 4 }, // no TVDB id: matched by number to a guid-less Plex episode
    { id: 5, tvdbId: 200777, seasonNumber: 1, episodeNumber: 4 }, // TVDB id not in Plex: falls back to the number
    { id: 6, tvdbId: 200009, seasonNumber: 1, episodeNumber: 2 }, // not in Plex; 1x2 is a Plex episode WITH a TVDB guid
    { id: 7, tvdbId: 200005, seasonNumber: 2, episodeNumber: 1 }, // two Plex copies: unwatched and watched
    { id: 8, tvdbId: null, seasonNumber: 9, episodeNumber: 9 }, // nothing in Plex matches
  ];

  it("matches an episode by its TVDB id", () => {
    const states = toEpisodeWatched(episodes, episodeItems);
    expect(states.get(1)).toBe("watched");
    expect(states.get(2)).toBe("partial");
    expect(states.get(3)).toBe("unwatched");
  });

  it("matches a Plex episode with no TVDB guid by season and episode number", () => {
    expect(toEpisodeWatched(episodes, episodeItems).get(4)).toBe("watched");
  });

  it("falls back to the number when the episode's TVDB id isn't in Plex", () => {
    expect(toEpisodeWatched(episodes, episodeItems).get(5)).toBe("watched");
  });

  it("never matches a Plex episode that has a TVDB guid by number", () => {
    expect(toEpisodeWatched(episodes, episodeItems).has(6)).toBe(false);
  });

  it("keeps the most watched copy when a TVDB id is listed twice, whichever comes first", () => {
    expect(toEpisodeWatched(episodes, episodeItems).get(7)).toBe("watched");
    expect(toEpisodeWatched(episodes, [...episodeItems].reverse()).get(7)).toBe("watched");
  });

  it("leaves an episode with no match out of the map, and ignores Plex episodes with no numbers", () => {
    const states = toEpisodeWatched(episodes, episodeItems);
    expect(states.has(8)).toBe(false);
    expect([...states.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 7]);
  });
});

describe("seasonWatchedState", () => {
  it("is watched when every episode is watched", () => {
    expect(seasonWatchedState(["watched", "watched"])).toBe("watched");
  });

  it("is partial for a mix of watched and unwatched", () => {
    expect(seasonWatchedState(["watched", "unwatched"])).toBe("partial");
  });

  it("is partial when one episode is partly watched among unwatched ones", () => {
    expect(seasonWatchedState(["unwatched", "partial", "unwatched"])).toBe("partial");
  });

  it("is partial when every episode is only partly watched, or partly watched mixed with watched", () => {
    expect(seasonWatchedState(["partial", "partial"])).toBe("partial");
    expect(seasonWatchedState(["watched", "partial"])).toBe("partial");
  });

  it("accepts any iterable, such as a Set", () => {
    expect(seasonWatchedState(new Set<"watched">(["watched"]))).toBe("watched");
  });

  it("is unwatched when every episode is unwatched", () => {
    expect(seasonWatchedState(["unwatched", "unwatched"])).toBe("unwatched");
  });

  it("ignores undefined entries", () => {
    expect(seasonWatchedState(["watched", undefined])).toBe("watched");
  });

  it("is null when there are no episodes or none has a state", () => {
    expect(seasonWatchedState([])).toBeNull();
    expect(seasonWatchedState([undefined, undefined])).toBeNull();
  });

  it("matches the season 1 episodes of the Plex episode fixture", () => {
    // Season 1 rows: 1 watched, 2 partial, 3 unwatched, 4 watched, 5 watched; 6 has no Plex match, so it is ignored.
    const season1: EpisodeRef[] = [
      { id: 1, tvdbId: 200001, seasonNumber: 1, episodeNumber: 1 },
      { id: 2, tvdbId: 200002, seasonNumber: 1, episodeNumber: 2 },
      { id: 3, tvdbId: 200003, seasonNumber: 1, episodeNumber: 3 },
      { id: 4, tvdbId: null, seasonNumber: 1, episodeNumber: 4 },
      { id: 5, tvdbId: 200777, seasonNumber: 1, episodeNumber: 4 },
      { id: 6, tvdbId: 200009, seasonNumber: 1, episodeNumber: 2 },
    ];
    const states = toEpisodeWatched(season1, episodeItems);
    expect(seasonWatchedState(season1.map((episode) => states.get(episode.id)))).toBe("partial");
  });
});

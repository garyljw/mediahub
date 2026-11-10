import "server-only";
import { describe, expect, it } from "vitest";
import type { PlexSectionItem } from "@/server/plex/server";
import { toPlexAddedIndex } from "./plex-added";

const item = (overrides: Partial<PlexSectionItem>): PlexSectionItem => ({
  guids: [],
  viewCount: 0,
  viewOffset: 0,
  leafCount: 0,
  viewedLeafCount: 0,
  ratingKey: null,
  addedAt: null,
  ...overrides,
});

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

describe("toPlexAddedIndex", () => {
  it("gives a show the newest addedAt among its episodes, not its own addedAt", () => {
    const show = item({ guids: ["tvdb://100001"], ratingKey: "2001", addedAt: 1600000000 });
    const index = toPlexAddedIndex(
      [],
      [show],
      [
        { showKey: "2001", addedAt: 1700000000 },
        { showKey: "2001", addedAt: 1710000000 },
        { showKey: "2001", addedAt: 1705000000 },
      ],
    );
    expect(index.series.get(100001)).toBe(iso(1710000000));
  });

  it("maps movies by their TMDB guid and series by their TVDB guid", () => {
    const movie = item({ guids: ["imdb://tt0000001", "tmdb://900001"], addedAt: 1700000000 });
    const show = item({ guids: ["tvdb://100001"], ratingKey: "2001" });
    const index = toPlexAddedIndex([movie], [show], [{ showKey: "2001", addedAt: 1710000000 }]);
    expect([...index.movies.keys()]).toEqual([900001]);
    expect([...index.series.keys()]).toEqual([100001]);
  });

  it("skips items with no matching guid, and items with no addedAt, and shows with no episodes", () => {
    const noGuid = item({ guids: ["imdb://tt0000002"], addedAt: 1700000000 });
    const noAddedAt = item({ guids: ["tmdb://900002"], addedAt: null });
    const noEpisodes = item({ guids: ["tvdb://100002"], ratingKey: "2002" });
    const noRatingKey = item({ guids: ["tvdb://100003"], ratingKey: null });
    const index = toPlexAddedIndex(
      [noGuid, noAddedAt],
      [noEpisodes, noRatingKey],
      // An episode for a show that isn't in the list, so nothing matches by ratingKey.
      [{ showKey: "2099", addedAt: 1710000000 }],
    );
    expect(index.movies.size).toBe(0);
    expect(index.series.size).toBe(0);
  });

  it("keeps the newest date when an id is listed more than once", () => {
    const older = item({ guids: ["tmdb://900001"], addedAt: 1600000000 });
    const newer = item({ guids: ["tmdb://900001"], addedAt: 1700000000 });
    expect(toPlexAddedIndex([older, newer], [], []).movies.get(900001)).toBe(iso(1700000000));
  });
});

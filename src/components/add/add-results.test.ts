import { describe, expect, it } from "vitest";
import { type AddItem, filterByKind, initialId, mergeResults, movieFormFor, movieItems, seriesFormFor, seriesItems } from "./add-results";

function movie(id: number): AddItem {
  return { key: `movie-${id}`, kind: "movie", externalId: id, title: `Movie ${id}`, year: null, network: null, overview: "", posterSrc: null, inLibrary: false };
}

function series(id: number): AddItem {
  return { key: `series-${id}`, kind: "series", externalId: id, title: `Series ${id}`, year: null, network: null, overview: "", posterSrc: null, inLibrary: false };
}

describe("mergeResults", () => {
  it("interleaves movies and series by rank", () => {
    expect(mergeResults([movie(1), movie(2)], [series(10), series(11)]).map((item) => item.key)).toEqual([
      "movie-1",
      "series-10",
      "movie-2",
      "series-11",
    ]);
  });

  it("appends the rest when movies are longer", () => {
    expect(mergeResults([movie(1), movie(2), movie(3)], [series(10)]).map((item) => item.key)).toEqual([
      "movie-1",
      "series-10",
      "movie-2",
      "movie-3",
    ]);
  });

  it("appends the rest when series are longer", () => {
    expect(mergeResults([movie(1)], [series(10), series(11), series(12)]).map((item) => item.key)).toEqual([
      "movie-1",
      "series-10",
      "series-11",
      "series-12",
    ]);
  });

  it("returns an empty list when both are empty, and a single list unchanged in order", () => {
    expect(mergeResults([], [])).toEqual([]);
    expect(mergeResults([movie(2), movie(1)], [])).toEqual([movie(2), movie(1)]);
  });
});

describe("initialId", () => {
  const options = [{ id: 4 }, { id: 2 }];

  it("uses the saved default when it is in the list", () => {
    expect(initialId(options, 2)).toBe(2);
  });

  it("uses the first item when the saved default is missing or null", () => {
    expect(initialId(options, 99)).toBe(4);
    expect(initialId(options, null)).toBe(4);
  });

  it("is null when the list is empty", () => {
    expect(initialId([], 2)).toBeNull();
  });
});

describe("movieFormFor and seriesFormFor", () => {
  const profiles = [{ id: 4, name: "Any" }, { id: 2, name: "HD" }];
  const folders = [{ id: 7, path: "/invented/movies/" }, { id: 8, path: "/invented/other/" }];

  it("starts a movie form on the saved profile and folder, with monitored and search on", () => {
    expect(movieFormFor({ profiles, folders, defaults: { profileId: 2, rootFolderId: 8 } })).toEqual({
      profileId: 2,
      rootFolderId: 8,
      monitored: true,
      searchForMovie: true,
    });
  });

  it("starts a series form on the saved monitor, standard type, season folders and search on", () => {
    expect(seriesFormFor({ profiles, folders, defaults: { profileId: 99, rootFolderId: null, monitor: "missing" } })).toEqual({
      profileId: 4,
      rootFolderId: 7,
      monitor: "missing",
      seriesType: "standard",
      seasonFolder: true,
      searchForMissingEpisodes: true,
    });
  });

  it("starts a series form on monitor all when none is saved", () => {
    expect(seriesFormFor({ profiles, folders, defaults: { profileId: null, rootFolderId: null, monitor: null } }).monitor).toBe("all");
  });
});

describe("filterByKind", () => {
  const items = [movie(1), series(10), movie(2)];

  it("keeps everything for all", () => {
    expect(filterByKind(items, "all")).toEqual(items);
  });

  it("keeps only movies or only series, in order", () => {
    expect(filterByKind(items, "movie").map((item) => item.key)).toEqual(["movie-1", "movie-2"]);
    expect(filterByKind(items, "series").map((item) => item.key)).toEqual(["series-10"]);
  });
});

describe("movieItems and seriesItems", () => {
  it("maps a movie hit to a row with the TMDB id and the lookup poster route", () => {
    expect(
      movieItems([{ tmdbId: 910001, title: "Lantern Harbour", year: 2021, overview: "A harbour.", inLibrary: true, posterFile: "abc123.jpg" }]),
    ).toEqual([
      {
        key: "movie-910001",
        kind: "movie",
        externalId: 910001,
        title: "Lantern Harbour",
        year: 2021,
        network: null,
        overview: "A harbour.",
        posterSrc: "/api/movies/lookup-poster/abc123.jpg",
        inLibrary: true,
      },
    ]);
  });

  it("maps a movie hit with no poster to a null poster source", () => {
    expect(movieItems([{ tmdbId: 1, title: "Film", year: null, overview: "", inLibrary: false, posterFile: null }])[0].posterSrc).toBeNull();
  });

  it("maps a series hit to a row with the TVDB id, network and the TV poster route", () => {
    expect(
      seriesItems([
        {
          tvdbId: 200001,
          title: "Harbour Lights",
          year: 2018,
          network: "Example TV",
          overview: "",
          inLibrary: false,
          posterPath: "banners/v4/series/200001/posters/abc.jpg",
        },
      ]),
    ).toEqual([
      {
        key: "series-200001",
        kind: "series",
        externalId: 200001,
        title: "Harbour Lights",
        year: 2018,
        network: "Example TV",
        overview: "",
        posterSrc: "/api/tv/lookup-poster/banners/v4/series/200001/posters/abc.jpg",
        inLibrary: false,
      },
    ]);
  });

  it("keeps a movie and a series with the same id as different rows", () => {
    const keys = [...movieItems([{ tmdbId: 5, title: "A", year: null, overview: "", inLibrary: false, posterFile: null }]), ...seriesItems([{ tvdbId: 5, title: "B", year: null, network: null, overview: "", inLibrary: false, posterPath: null }])].map(
      (item) => item.key,
    );
    expect(new Set(keys).size).toBe(2);
  });
});

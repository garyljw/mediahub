import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareHomeItems,
  DEFAULT_HOME_SORT,
  filterHomeItems,
  genreOptions,
  HOME_SORT_KEY,
  readHomeSort,
  saveHomeSort,
  sortHomeItems,
  hasWatchData,
  withDownloaded,
  withWatched,
  type HomeItem,
  type HomeSortDir,
  type HomeSortKey,
} from "./home-items";

function item(overrides: Partial<HomeItem> & { id: number; title: string; kind: HomeItem["kind"] }): HomeItem {
  return {
    key: `${overrides.kind}:${overrides.id}`,
    year: null,
    sortTitle: overrides.title.toLowerCase(),
    released: null,
    latest: null,
    sizeOnDisk: 0,
    downloaded: null,
    href: `/${overrides.kind}/${overrides.id}`,
    posterSrc: null,
    badge: { label: "Missing", className: "" },
    onDisk: true,
    watched: null,
    inFocus: false,
    genres: [],
    ...overrides,
  };
}

const items: HomeItem[] = [
  item({ kind: "movie", id: 1, title: "Harbour Lights", year: 2019 }),
  item({ kind: "series", id: 2, title: "Harbour Watch", year: 2021 }),
  item({ kind: "movie", id: 3, title: "Night Circuit", year: 2024 }),
  item({ kind: "series", id: 4, title: "Glass Orchard" }),
];

const titles = (list: HomeItem[]) => list.map((entry) => entry.title);

describe("filterHomeItems", () => {
  it("returns everything for kind all and an empty search", () => {
    expect(filterHomeItems(items, { kind: "all", search: "" })).toHaveLength(4);
  });

  it("keeps only movies or only series", () => {
    expect(titles(filterHomeItems(items, { kind: "movie", search: "" }))).toEqual(["Harbour Lights", "Night Circuit"]);
    expect(titles(filterHomeItems(items, { kind: "series", search: "" }))).toEqual(["Harbour Watch", "Glass Orchard"]);
  });

  it("matches the title case-insensitively", () => {
    expect(titles(filterHomeItems(items, { kind: "all", search: "HARBOUR" }))).toEqual([
      "Harbour Lights",
      "Harbour Watch",
    ]);
  });

  it("matches the year", () => {
    expect(titles(filterHomeItems(items, { kind: "all", search: "2024" }))).toEqual(["Night Circuit"]);
  });

  it("ignores surrounding spaces in the search", () => {
    expect(titles(filterHomeItems(items, { kind: "all", search: "  glass  " }))).toEqual(["Glass Orchard"]);
  });

  it("applies the kind and the search together", () => {
    expect(titles(filterHomeItems(items, { kind: "series", search: "harbour" }))).toEqual(["Harbour Watch"]);
  });

  it("returns nothing when no title or year matches", () => {
    expect(filterHomeItems(items, { kind: "all", search: "zzz" })).toEqual([]);
  });

  it("matches part of a year", () => {
    // "202" is inside both 2021 and 2024.
    expect(titles(filterHomeItems(items, { kind: "all", search: "202" }))).toEqual(["Harbour Watch", "Night Circuit"]);
  });
});

describe("filterHomeItems watch status", () => {
  const watchItems: HomeItem[] = [
    item({ kind: "movie", id: 1, title: "Harbour Lights", watched: "unwatched" }),
    item({ kind: "series", id: 2, title: "Harbour Watch", watched: "partial" }),
    item({ kind: "movie", id: 3, title: "Night Circuit", watched: "watched" }),
    item({ kind: "series", id: 4, title: "Glass Orchard", watched: null }),
    item({ kind: "movie", id: 5, title: "Harbour Fields", watched: "watched" }),
  ];

  it("keeps everything for any, and when the watch filter is omitted", () => {
    expect(filterHomeItems(watchItems, { kind: "all", search: "", watched: "any" })).toHaveLength(5);
    expect(filterHomeItems(watchItems, { kind: "all", search: "" })).toHaveLength(5);
  });

  it("keeps only items in each specific watched state", () => {
    expect(titles(filterHomeItems(watchItems, { kind: "all", search: "", watched: "unwatched" }))).toEqual([
      "Harbour Lights",
    ]);
    expect(titles(filterHomeItems(watchItems, { kind: "all", search: "", watched: "partial" }))).toEqual([
      "Harbour Watch",
    ]);
    expect(titles(filterHomeItems(watchItems, { kind: "all", search: "", watched: "watched" }))).toEqual([
      "Night Circuit",
      "Harbour Fields",
    ]);
  });

  it("excludes items Plex doesn't know from a specific state", () => {
    const withNull = filterHomeItems(watchItems, { kind: "all", search: "", watched: "unwatched" });
    expect(titles(withNull)).not.toContain("Glass Orchard");
    expect(titles(filterHomeItems(watchItems, { kind: "all", search: "glass", watched: "watched" }))).toEqual([]);
  });

  it("combines the watch filter with the kind and the search", () => {
    expect(titles(filterHomeItems(watchItems, { kind: "movie", search: "", watched: "watched" }))).toEqual([
      "Night Circuit",
      "Harbour Fields",
    ]);
    expect(titles(filterHomeItems(watchItems, { kind: "series", search: "", watched: "watched" }))).toEqual([]);
    expect(titles(filterHomeItems(watchItems, { kind: "all", search: "harbour", watched: "watched" }))).toEqual([
      "Harbour Fields",
    ]);
  });
});

describe("hasWatchData", () => {
  it("is false for an empty list", () => {
    expect(hasWatchData([])).toBe(false);
  });

  it("is false when every title has a null watched state", () => {
    expect(hasWatchData([item({ kind: "movie", id: 1, title: "A" }), item({ kind: "series", id: 2, title: "B" })])).toBe(
      false,
    );
  });

  it("is true when one title has a watched state", () => {
    expect(
      hasWatchData([
        item({ kind: "movie", id: 1, title: "A" }),
        item({ kind: "series", id: 2, title: "B", watched: "unwatched" }),
      ]),
    ).toBe(true);
  });
});

describe("compareHomeItems", () => {
  const sorted = (list: HomeItem[]) => [...list].sort(compareHomeItems);

  it("sorts A–Z by sort title, ignoring the release date", () => {
    const zulu = item({ kind: "movie", id: 1, title: "Zulu", released: "2020-06-01T00:00:00Z" });
    const alpha = item({ kind: "series", id: 2, title: "Alpha", released: "2026-01-01T00:00:00Z" });
    expect(titles(sorted([zulu, alpha]))).toEqual(["Alpha", "Zulu"]);
  });

  it("uses the sort title, so a leading article doesn't count", () => {
    const beekeeper = item({ kind: "movie", id: 1, title: "The Beekeeper", sortTitle: "beekeeper" });
    const carrie = item({ kind: "movie", id: 2, title: "Carrie", sortTitle: "carrie" });
    const alpha = item({ kind: "movie", id: 3, title: "Alpha", sortTitle: "alpha" });
    expect(titles(sorted([carrie, beekeeper, alpha]))).toEqual(["Alpha", "The Beekeeper", "Carrie"]);
  });

  it("sorts accented titles in place", () => {
    const e = item({ kind: "movie", id: 1, title: "Éclair", sortTitle: "éclair" });
    const z = item({ kind: "movie", id: 2, title: "Zulu", sortTitle: "zulu" });
    const a = item({ kind: "movie", id: 3, title: "Alpha", sortTitle: "alpha" });
    expect(titles(sorted([z, e, a]))).toEqual(["Alpha", "Éclair", "Zulu"]);
  });

  it("puts a movie before a series when the sort titles tie", () => {
    const series = item({ kind: "series", id: 1, title: "Same" });
    const movie = item({ kind: "movie", id: 9, title: "Same" });
    expect(sorted([series, movie]).map((entry) => entry.kind)).toEqual(["movie", "series"]);
  });

  it("breaks the last tie by id", () => {
    const high = item({ kind: "movie", id: 9, title: "Same" });
    const low = item({ kind: "movie", id: 2, title: "Same" });
    expect(sorted([high, low]).map((entry) => entry.id)).toEqual([2, 9]);
  });
});

describe("withWatched", () => {
  const plain = [
    item({ kind: "movie", id: 1, title: "Harbour Lights" }),
    item({ kind: "series", id: 2, title: "Harbour Watch" }),
  ];

  it("sets the watched state from the key map, and null for a key not in it", () => {
    const merged = withWatched(plain, { "movie:1": "watched" });
    expect(merged[0].watched).toBe("watched");
    expect(merged[1].watched).toBeNull();
  });

  it("gives every item null when the map is null", () => {
    const withState = plain.map((entry) => ({ ...entry, watched: "partial" as const }));
    expect(withItemStates(withWatched(withState, null))).toEqual([null, null]);
  });

  it("keeps the same object for an item whose state doesn't change", () => {
    const merged = withWatched(plain, { "movie:1": "unwatched" });
    expect(merged[1]).toBe(plain[1]);
    expect(merged[0]).not.toBe(plain[0]);
  });

  it("returns the same array when no state changes", () => {
    expect(withWatched(plain, {})).toBe(plain);
    expect(withWatched(plain, null)).toBe(plain);
  });

  it("does not change the input items", () => {
    withWatched(plain, { "movie:1": "watched" });
    expect(plain[0].watched).toBeNull();
  });
});

function withItemStates(list: HomeItem[]): (HomeItem["watched"])[] {
  return list.map((entry) => entry.watched);
}

describe("sortHomeItems", () => {
  const alpha = item({ kind: "movie", id: 1, title: "Alpha", released: "2020-01-01T00:00:00Z", latest: "2026-03-01T00:00:00Z", sizeOnDisk: 3000, downloaded: { at: "2024-05-01T00:00:00Z", recorded: true } });
  const bravo = item({ kind: "series", id: 2, title: "Bravo", released: "2024-06-01T00:00:00Z", latest: "2021-01-01T00:00:00Z", sizeOnDisk: 1000, downloaded: { at: "2025-01-01T00:00:00Z", recorded: true } });
  const charlie = item({ kind: "movie", id: 3, title: "Charlie", released: "2022-03-03T00:00:00Z", latest: "2025-01-01T00:00:00Z", sizeOnDisk: 2000, downloaded: { at: "2023-02-02T00:00:00Z", recorded: false } });
  const delta = item({ kind: "series", id: 4, title: "Delta", released: "2021-07-07T00:00:00Z", latest: "2023-01-01T00:00:00Z", sizeOnDisk: 4000, downloaded: { at: "2024-12-12T00:00:00Z", recorded: false } });
  const mixed = [delta, charlie, bravo, alpha];

  it.each<[HomeSortKey, HomeSortDir, string[]]>([
    ["title", "asc", ["Alpha", "Bravo", "Charlie", "Delta"]],
    ["title", "desc", ["Delta", "Charlie", "Bravo", "Alpha"]],
    ["downloaded", "desc", ["Bravo", "Alpha", "Delta", "Charlie"]],
    ["downloaded", "asc", ["Alpha", "Bravo", "Charlie", "Delta"]],
    ["released", "desc", ["Bravo", "Charlie", "Delta", "Alpha"]],
    ["released", "asc", ["Alpha", "Delta", "Charlie", "Bravo"]],
    // Ordered by latest, which disagrees with the released order above.
    ["latest", "desc", ["Alpha", "Charlie", "Delta", "Bravo"]],
    ["latest", "asc", ["Bravo", "Delta", "Charlie", "Alpha"]],
    ["size", "desc", ["Delta", "Alpha", "Charlie", "Bravo"]],
    ["size", "asc", ["Bravo", "Charlie", "Alpha", "Delta"]],
  ])("sorts by %s %s", (key, dir, expected) => {
    expect(titles(sortHomeItems(mixed, key, dir))).toEqual(expected);
  });

  it.each<[HomeSortKey, HomeSortDir]>([
    ["downloaded", "asc"],
    ["downloaded", "desc"],
    ["released", "asc"],
    ["released", "desc"],
    ["latest", "asc"],
    ["latest", "desc"],
    ["size", "asc"],
    ["size", "desc"],
  ])("puts items with no value last when sorting by %s %s", (key, dir) => {
    // Zulu has a value for every sort. Alpha has no date and no size (size 0). Mike has an unparsable date and size 0.
    const valued = item({ kind: "movie", id: 1, title: "Zulu", released: "2020-01-01T00:00:00Z", latest: "2020-01-01T00:00:00Z", downloaded: { at: "2020-01-01T00:00:00Z", recorded: true }, sizeOnDisk: 5 });
    const noDate = item({ kind: "movie", id: 2, title: "Alpha", released: null, latest: null, downloaded: null, sizeOnDisk: 0 });
    const badDate = item({ kind: "movie", id: 3, title: "Mike", released: "not a date", latest: "not a date", downloaded: { at: "not a date", recorded: true }, sizeOnDisk: 0 });
    expect(titles(sortHomeItems([badDate, noDate, valued], key, dir))).toEqual(["Zulu", "Alpha", "Mike"]);
  });

  it.each(["asc", "desc"] as const)("groups recorded imports, then file dates, then no date, in %s order", (dir) => {
    const recordedOld = item({ kind: "movie", id: 1, title: "Alpha", downloaded: { at: "2020-01-01T00:00:00Z", recorded: true } });
    const recordedNew = item({ kind: "series", id: 2, title: "Bravo", downloaded: { at: "2024-01-01T00:00:00Z", recorded: true } });
    const fileOnly = item({ kind: "movie", id: 3, title: "Charlie", downloaded: { at: "2025-06-01T00:00:00Z", recorded: false } });
    const none = item({ kind: "movie", id: 4, title: "Delta", downloaded: null });
    const sorted = titles(sortHomeItems([none, fileOnly, recordedOld, recordedNew], "downloaded", dir));
    // Within the recorded group the dates follow the direction. The file-date and no-date groups always come after it.
    expect(sorted).toEqual(dir === "asc" ? ["Alpha", "Bravo", "Charlie", "Delta"] : ["Bravo", "Alpha", "Charlie", "Delta"]);
  });

  it("breaks ties A–Z in both directions", () => {
    const bravoMovie = item({ kind: "movie", id: 2, title: "Bravo", sizeOnDisk: 100 });
    const alphaSeries = item({ kind: "series", id: 1, title: "Alpha", sizeOnDisk: 100 });
    expect(titles(sortHomeItems([bravoMovie, alphaSeries], "size", "desc"))).toEqual(["Alpha", "Bravo"]);
    expect(titles(sortHomeItems([bravoMovie, alphaSeries], "size", "asc"))).toEqual(["Alpha", "Bravo"]);
  });
});

describe("withDownloaded", () => {
  const plain = [
    item({ kind: "movie", id: 1, title: "Harbour Lights", downloaded: { at: "2024-01-01T00:00:00Z", recorded: true } }),
    item({ kind: "series", id: 2, title: "Harbour Watch" }),
  ];

  it("sets a movie's and a series' date from the key map, and null for an item not in it", () => {
    const merged = withDownloaded(plain, { "series:2": { at: "2025-02-02T00:00:00Z", recorded: false } });
    expect(merged[1].downloaded).toEqual({ at: "2025-02-02T00:00:00Z", recorded: false });
    expect(withDownloaded(plain, {})[0].downloaded).toBeNull();
    expect(withDownloaded(plain, {})[1].downloaded).toBeNull();
  });

  it("keeps the same object for an item whose date doesn't change, and the same array when nothing changes", () => {
    const withDate = withDownloaded(plain, { "series:2": { at: "2025-02-02T00:00:00Z", recorded: true } });
    expect(withDownloaded(withDate, { "series:2": { at: "2025-02-02T00:00:00Z", recorded: true } })).toBe(withDate);
    expect(withDownloaded(plain, { "movie:1": { at: "2024-01-01T00:00:00Z", recorded: true } })).toBe(plain);
    expect(withDownloaded(plain, null)[0]).not.toBe(plain[0]);
  });
});

describe("readHomeSort and saveHomeSort", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStorage(store: Record<string, string>) {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    });
  }

  it.each<[HomeSortKey, HomeSortDir]>([
    ["released", "desc"],
    ["latest", "asc"],
  ])("reads back a saved %s sort (%s)", (key, dir) => {
    stubStorage({ [HOME_SORT_KEY]: JSON.stringify({ key, dir }) });
    expect(readHomeSort()).toEqual({ key, dir });
  });

  it("reads back what was saved", () => {
    stubStorage({});
    saveHomeSort({ key: "size", dir: "asc" });
    expect(readHomeSort()).toEqual({ key: "size", dir: "asc" });
  });

  it.each([['{"key":"nope","dir":"asc"}'], ['{"key":"size","dir":"sideways"}'], ["not json"], ["null"]])(
    "falls back to the default for the stored value %s",
    (raw) => {
      stubStorage({ [HOME_SORT_KEY]: raw });
      expect(readHomeSort()).toEqual(DEFAULT_HOME_SORT);
    },
  );

  it("uses the default, and does not throw on save, when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => {
        throw new Error("storage denied");
      },
    });
    expect(readHomeSort()).toEqual(DEFAULT_HOME_SORT);
    expect(() => saveHomeSort({ key: "size", dir: "desc" })).not.toThrow();
  });
});

describe("genre filter", () => {
  const genreItems: HomeItem[] = [
    item({ kind: "movie", id: 1, title: "Harbour Lights", genres: ["Drama", "Science Fiction"], watched: "unwatched" }),
    item({ kind: "series", id: 2, title: "Harbour Watch", genres: ["Science Fiction"], watched: "watched" }),
    item({ kind: "movie", id: 3, title: "Night Circuit", genres: ["Action", "Drama"], watched: "unwatched" }),
    item({ kind: "series", id: 4, title: "Glass Orchard", genres: ["Animation"] }),
  ];

  it("keeps the movies and the series with the genre, and everything for null or missing", () => {
    expect(titles(filterHomeItems(genreItems, { kind: "all", search: "", genre: "Science Fiction" }))).toEqual([
      "Harbour Lights",
      "Harbour Watch",
    ]);
    expect(filterHomeItems(genreItems, { kind: "all", search: "", genre: null })).toHaveLength(4);
    expect(filterHomeItems(genreItems, { kind: "all", search: "" })).toHaveLength(4);
  });

  it("matches the exact name only", () => {
    expect(filterHomeItems(genreItems, { kind: "all", search: "", genre: "science fiction" })).toEqual([]);
  });

  it("combines with kind, watched and search", () => {
    const base = { kind: "all", search: "", genre: "Science Fiction" } as const;
    expect(titles(filterHomeItems(genreItems, { ...base, kind: "series" }))).toEqual(["Harbour Watch"]);
    expect(titles(filterHomeItems(genreItems, { ...base, watched: "unwatched" }))).toEqual(["Harbour Lights"]);
    expect(titles(filterHomeItems(genreItems, { ...base, search: "watch" }))).toEqual(["Harbour Watch"]);
  });
});

describe("genreOptions", () => {
  const genreItems: HomeItem[] = [
    item({ kind: "movie", id: 1, title: "A", genres: ["Drama", "Science Fiction"] }),
    item({ kind: "series", id: 2, title: "B", genres: ["Science Fiction", "Animation"] }),
    item({ kind: "movie", id: 3, title: "C", genres: ["Drama"] }),
  ];

  it("counts per kind and sorts A-Z", () => {
    expect(genreOptions(genreItems, "all")).toEqual([
      { genre: "Animation", count: 1 },
      { genre: "Drama", count: 2 },
      { genre: "Science Fiction", count: 2 },
    ]);
    expect(genreOptions(genreItems, "movie")).toEqual([
      { genre: "Drama", count: 2 },
      { genre: "Science Fiction", count: 1 },
    ]);
  });

  it("keeps the chosen genre listed with count 0 when the kind has none", () => {
    expect(genreOptions(genreItems, "movie", "Animation")).toEqual([
      { genre: "Animation", count: 0 },
      { genre: "Drama", count: 2 },
      { genre: "Science Fiction", count: 1 },
    ]);
  });
});

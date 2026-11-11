import "server-only";
import { describe, expect, it } from "vitest";
import type { components as RadarrComponents } from "../arr/generated/radarr";
import type { components as SonarrComponents } from "../arr/generated/sonarr";
import radarrFixture from "./__fixtures__/radarr-calendar.json";
import sonarrFixture from "./__fixtures__/sonarr-calendar.json";
import { toCalendarEntries, type CalendarEntry } from "./calendar";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];
type EpisodeResource = SonarrComponents["schemas"]["EpisodeResource"];

// The fixtures include malformed items on purpose, so they are cast rather than typed as upstream output.
const movies = radarrFixture as unknown as MovieResource[];
const episodes = sonarrFixture as unknown as EpisodeResource[];

// A Monday to the Sunday five weeks later, the same window the page asks for.
const FROM = "2026-11-02";
const TO = "2026-12-06";
// Noon on Nov 8: episodes that aired up to Nov 7 are past, and the one airing on Nov 10 has not aired yet.
const NOW = Date.parse("2026-11-08T12:00:00Z");

function merged(): CalendarEntry[] {
  return toCalendarEntries(movies, episodes, FROM, TO, NOW);
}

/** The entries as short tuples, so the whole list can be compared in one readable assertion. */
function summary(entries: CalendarEntry[]) {
  return entries.map((entry) => [
    entry.date,
    entry.kind,
    entry.title,
    entry.detail,
    entry.status,
  ]);
}

function find(key: string): CalendarEntry {
  const entry = merged().find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`no entry ${key}`);
  return entry;
}

describe("toCalendarEntries", () => {
  it("returns the expected entries, sorted by date, then movies before episodes, then sort title and detail", () => {
    expect(summary(merged())).toEqual([
      [
        "2026-11-02",
        "episode",
        "Harbour Lights",
        "S03E01 · Unlisted",
        "unmonitored",
      ],
      ["2026-11-03", "episode", "Harbour Lights", "S01E01 · Pilot", "missing"],
      [
        "2026-11-03",
        "episode",
        "Harbour Lights",
        "S01E03 · Third",
        "downloaded",
      ],
      [
        "2026-11-04",
        "episode",
        "Harbour Lights",
        "S02E05 · Tidewater",
        "unmonitored",
      ],
      ["2026-11-06", "movie", "The Archive", "In cinemas", "notAvailable"],
      ["2026-11-06", "movie", "Starfall", "In cinemas", "missing"],
      ["2026-11-07", "episode", "Harbour Lights", "S00E01 · TBA", "missing"],
      [
        "2026-11-08",
        "episode",
        "Harbour Lights",
        "S01E04 · Fourth",
        "unmonitored",
      ],
      ["2026-11-08", "episode", "Harbour Lights", "S01E05 · Fifth", "upcoming"],
      ["2026-11-09", "episode", "Sea Glass", "S01E01 · Glass", "unmonitored"],
      [
        "2026-11-10",
        "movie",
        "Quiet Harbour",
        "Digital release",
        "unmonitored",
      ],
      [
        "2026-11-10",
        "episode",
        "Harbour Lights",
        "S01E02 · Second",
        "upcoming",
      ],
      ["2026-11-12", "movie", "Ember Road", "Physical release", "downloaded"],
      ["2026-11-20", "movie", "Lantern Coast", "In cinemas", "upcoming"],
      ["2026-11-30", "movie", "Bad Date", "Digital release", "upcoming"],
      ["2026-12-01", "movie", "Starfall", "Digital release", "upcoming"],
    ]);
  });

  it("gives a movie one entry per release date in the range", () => {
    // Starfall has a cinema date on Nov 6 and a digital date on Dec 1. Its physical date is in 2027, so it is dropped.
    const starfall = merged().filter((entry) => entry.title === "Starfall");
    expect(
      starfall.map((entry) => [entry.key, entry.date, entry.releaseType]),
    ).toEqual([
      ["movie-101-cinema", "2026-11-06", "cinema"],
      ["movie-101-digital", "2026-12-01", "digital"],
    ]);
  });

  it("drops movie dates outside the range and sonarr episodes whose air date is outside it", () => {
    const keys = merged().map((entry) => entry.key);
    // 105 was released in June. 706 is an episode Sonarr sent (its window is a day wider) but it aired on Oct 30.
    expect(keys.some((key) => key.startsWith("movie-105"))).toBe(false);
    expect(keys).not.toContain("episode-706");
  });

  it("keeps the valid date of a movie whose other date is not a date", () => {
    expect(summary(merged()).filter((row) => row[2] === "Bad Date")).toEqual([
      ["2026-11-30", "movie", "Bad Date", "Digital release", "upcoming"],
    ]);
  });

  it("skips malformed items without a numeric id, a title, an air date or a series title", () => {
    const keys = merged().map((entry) => entry.key);
    // 106: string id. 107: empty title. 707: no air date. 708: series has no title.
    expect(keys.some((key) => key.includes("106") || key.includes("107"))).toBe(
      false,
    );
    expect(keys).not.toContain("episode-707");
    expect(keys).not.toContain("episode-708");
  });

  it("gives downloaded to items with a file", () => {
    expect(find("movie-103-physical").status).toBe("downloaded");
    expect(find("episode-704").status).toBe("downloaded");
  });

  it("gives missing to a released movie or aired episode that is wanted and has no file", () => {
    expect(find("movie-101-cinema").status).toBe("missing");
    expect(find("episode-702").status).toBe("missing");
    expect(find("episode-705").status).toBe("missing");
  });

  it("gives upcoming to a movie not yet available and an episode that has not aired", () => {
    expect(find("movie-104-cinema").status).toBe("upcoming");
    expect(find("episode-703").status).toBe("upcoming");
  });

  it("works out a movie's status per release date, not once per movie", () => {
    // Starfall is available with no file: its passed cinema date is missing, its digital date (Dec 1) still ahead.
    expect(find("movie-101-cinema").status).toBe("missing");
    expect(find("movie-101-digital").status).toBe("upcoming");
  });

  it("gives notAvailable to a passed movie date while Radarr says the movie isn't available", () => {
    expect(find("movie-109-cinema").status).toBe("notAvailable");
  });

  it("checks file and monitored before the release date and availability", () => {
    // Nov 8 is "today" (NOW). A passed date with isAvailable false must still say downloaded or unmonitored first.
    const base = {
      title: "Precedence",
      isAvailable: false,
      inCinemas: "2026-11-05T00:00:00Z",
    };
    const statuses = toCalendarEntries(
      [
        { ...base, id: 201, monitored: true, hasFile: true },
        { ...base, id: 202, monitored: false, hasFile: false },
      ] as MovieResource[],
      [],
      FROM,
      TO,
      NOW,
    ).map((entry) => [entry.key, entry.status]);
    expect(statuses).toEqual([
      ["movie-201-cinema", "downloaded"],
      ["movie-202-cinema", "unmonitored"],
    ]);
  });

  it("treats a movie release dated today as released, not upcoming", () => {
    const [entry] = toCalendarEntries(
      [
        {
          id: 203,
          title: "Today",
          monitored: true,
          hasFile: false,
          isAvailable: true,
          digitalRelease: "2026-11-08T00:00:00Z",
        },
      ] as MovieResource[],
      [],
      FROM,
      TO,
      NOW,
    );
    expect(entry.status).toBe("missing");
  });

  it("orders titles and episode numbers numerically, like the library tables", () => {
    const movies = [
      {
        id: 301,
        title: "10 Cloverfield Lane",
        monitored: true,
        hasFile: true,
        inCinemas: "2026-11-05T00:00:00Z",
      },
      {
        id: 302,
        title: "2 Guns",
        monitored: true,
        hasFile: true,
        inCinemas: "2026-11-05T00:00:00Z",
      },
    ] as MovieResource[];
    const series = {
      title: "Daily",
      monitored: true,
      seasons: [{ seasonNumber: 1, monitored: true }],
    };
    const shows = [
      {
        id: 401,
        seriesId: 9,
        seasonNumber: 1,
        episodeNumber: 100,
        airDate: "2026-11-05",
        hasFile: true,
        series,
      },
      {
        id: 402,
        seriesId: 9,
        seasonNumber: 1,
        episodeNumber: 99,
        airDate: "2026-11-05",
        hasFile: true,
        series,
      },
    ] as EpisodeResource[];
    const keys = toCalendarEntries(movies, shows, FROM, TO, NOW).map(
      (entry) => entry.key,
    );
    expect(keys).toEqual([
      "movie-302-cinema",
      "movie-301-cinema",
      "episode-402",
      "episode-401",
    ]);
  });

  it("looks up each episode's own season, even when an earlier episode of the series came without its seasons", () => {
    const full = {
      title: "Partial",
      monitored: true,
      seasons: [{ seasonNumber: 1, monitored: true }],
    };
    const shows = [
      {
        id: 501,
        seriesId: 8,
        seasonNumber: 1,
        episodeNumber: 1,
        airDate: "2026-11-03",
        airDateUtc: "2026-11-03T20:00:00Z",
        monitored: true,
        series: { title: "Partial", monitored: true },
      },
      {
        id: 502,
        seriesId: 8,
        seasonNumber: 1,
        episodeNumber: 2,
        airDate: "2026-11-04",
        airDateUtc: "2026-11-04T20:00:00Z",
        monitored: true,
        series: full,
      },
    ] as EpisodeResource[];
    const statuses = toCalendarEntries([], shows, FROM, TO, NOW).map(
      (entry) => [entry.key, entry.status],
    );
    expect(statuses).toEqual([
      ["episode-501", "unmonitored"],
      ["episode-502", "missing"],
    ]);
  });

  it("sorts entries on the same day by sort title, as the library tables do", () => {
    // "The Archive" has the sort title "archive", so it comes before "Starfall".
    const nov6 = merged().filter((entry) => entry.date === "2026-11-06");
    expect(nov6.map((entry) => entry.title)).toEqual([
      "The Archive",
      "Starfall",
    ]);
  });

  it("gives upcoming to an episode with no air-date time, so it is not reported as missing", () => {
    expect(find("episode-710").status).toBe("upcoming");
  });

  it("gives unmonitored to an unmonitored movie, an unmonitored episode, and episodes of an unmonitored season or series", () => {
    expect(find("movie-102-digital").status).toBe("unmonitored");
    expect(find("episode-709").status).toBe("unmonitored");
    // Season 2 is unmonitored, so its episode is not wanted even though the episode and series are monitored.
    expect(find("episode-701").status).toBe("unmonitored");
    // The series itself is unmonitored.
    expect(find("episode-801").status).toBe("unmonitored");
  });

  it("treats an episode whose season Sonarr doesn't list as unmonitored, like the series page", () => {
    // Season 3 is not in the series' season list, so the episode is not wanted.
    expect(find("episode-711").status).toBe("unmonitored");
  });

  it("labels a specials episode as season 0 and shows TBA for a missing title", () => {
    const special = find("episode-705");
    expect(special.detail).toBe("S00E01 · TBA");
    expect(special.kind).toBe("episode");
  });

  it("links a movie to its movie page and an episode to its series", () => {
    expect(find("movie-101-cinema").href).toBe("/movies/101");
    expect(find("episode-703").href).toBe("/tv/7");
    expect(find("episode-801").href).toBe("/tv/8");
  });

  it("gives a poster route only when the item has a poster", () => {
    expect(find("movie-101-cinema").posterSrc).toBe("/api/movies/101/poster");
    expect(find("movie-102-digital").posterSrc).toBeNull();
    expect(find("episode-703").posterSrc).toBe("/api/tv/7/poster");
    expect(find("episode-801").posterSrc).toBeNull();
  });

  it("gives each entry a short detail for grid chips", () => {
    expect(find("movie-101-digital").shortDetail).toBe("Digital");
    expect(find("movie-103-physical").shortDetail).toBe("Physical");
    expect(find("episode-703").shortDetail).toMatch(/^S\d{2}E\d{2}$/);
  });

  it("gives episodes a null release type and movies their release type", () => {
    expect(find("episode-703").releaseType).toBeNull();
    expect(find("movie-103-physical").releaseType).toBe("physical");
    expect(find("movie-101-digital").releaseType).toBe("digital");
  });

  it("returns only the calendar fields, with no paths, file info or upstream URLs", () => {
    for (const entry of merged()) {
      expect(Object.keys(entry).sort()).toEqual([
        "date",
        "detail",
        "href",
        "key",
        "kind",
        "peek",
        "posterSrc",
        "releaseType",
        "shortDetail",
        "status",
        "title",
      ]);
      // The peek is the only place an overview goes, and it holds just these three fields.
      if (entry.peek !== null) expect(Object.keys(entry.peek).sort()).toEqual(["genres", "overview", "year"]);
    }
    const serialized = JSON.stringify(merged());
    expect(serialized).not.toContain("/movies/Starfall");
    expect(serialized).not.toContain("/tv/Harbour Lights");
    expect(serialized).not.toContain("image.test");
    expect(serialized).not.toContain("apikey");
  });

  it("gives each movie and episode its peek, from the movie or its series", () => {
    expect(find("movie-101-cinema").peek).toStrictEqual({
      year: 2026,
      genres: [],
      overview: "A made-up film for tests.",
    });
    expect(find("episode-703").peek).toStrictEqual({
      year: null,
      genres: [],
      overview: "A made-up show for tests.",
    });
  });

  it("returns nothing for empty inputs", () => {
    expect(toCalendarEntries([], [], FROM, TO, NOW)).toEqual([]);
  });
});

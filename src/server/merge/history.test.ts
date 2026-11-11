import "server-only";
import { describe, expect, it } from "vitest";
import type { components as RadarrComponents } from "../arr/generated/radarr";
import type { components as SonarrComponents } from "../arr/generated/sonarr";
import radarrFixture from "./__fixtures__/radarr-history.json";
import sonarrFixture from "./__fixtures__/sonarr-history.json";
import {
  eventOf,
  radarrEventCodes,
  reasonText,
  sonarrEventCodes,
  toHistoryEntries,
  type HistoryEntry,
} from "./history";

type MovieHistoryRecord = RadarrComponents["schemas"]["HistoryResource"];
type EpisodeHistoryRecord = SonarrComponents["schemas"]["HistoryResource"];

// The fixtures include malformed records on purpose, so they are cast rather than typed as upstream output.
const movieRecords = radarrFixture as unknown as MovieHistoryRecord[];
const episodeRecords = sonarrFixture as unknown as EpisodeHistoryRecord[];

const LONDON = "Europe/London";

function merged(limit = 100, timeZone = LONDON): HistoryEntry[] {
  return toHistoryEntries(movieRecords, episodeRecords, limit, timeZone);
}

function find(key: string, limit = 100): HistoryEntry {
  const entry = merged(limit).find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`no entry ${key}`);
  return entry;
}

describe("toHistoryEntries", () => {
  it("merges both apps newest first, with ties broken by key, and drops malformed records", () => {
    expect(merged().map((entry) => entry.key)).toEqual([
      "movie-1",
      "episode-1",
      "episode-2",
      "movie-11",
      "movie-2",
      "movie-3",
      "episode-3",
      "episode-4",
      "episode-5",
      "episode-6",
      "episode-7",
      "movie-4",
      "movie-5",
      "movie-6",
      "episode-8",
      "episode-9",
      "movie-7",
      "movie-8",
      "movie-9",
    ]);
  });

  it("keeps only the first limit entries", () => {
    expect(merged(3).map((entry) => entry.key)).toEqual(["movie-1", "episode-1", "episode-2"]);
  });

  it("maps every upstream event type to a HistoryEvent", () => {
    const events = Object.fromEntries(merged().map((entry) => [entry.key, entry.event]));
    expect(events).toEqual({
      "movie-1": "grabbed",
      "episode-1": "grabbed",
      "episode-2": "imported",
      "movie-11": "grabbed",
      "movie-2": "imported",
      "movie-3": "failed",
      "episode-3": "imported",
      "episode-4": "failed",
      "episode-5": "deleted",
      "episode-6": "renamed",
      "episode-7": "ignored",
      "movie-4": "deleted",
      "movie-5": "renamed",
      "movie-6": "ignored",
      "episode-8": "grabbed",
      "episode-9": "unknown",
      "movie-7": "grabbed",
      "movie-8": "unknown",
      "movie-9": "imported",
    });
  });

  it("allows Mark as failed only on grabbed records", () => {
    const allowed = merged().filter((entry) => entry.canMarkFailed).map((entry) => entry.key);
    expect(allowed).toEqual(["movie-1", "episode-1", "movie-11", "episode-8", "movie-7"]);
  });

  it("gives each entry the app and the Arr's own history id", () => {
    expect(find("movie-1")).toMatchObject({ app: "radarr", historyId: 1, kind: "movie" });
    expect(find("episode-2")).toMatchObject({ app: "sonarr", historyId: 2, kind: "episode" });
  });

  it("shows a movie with its title, year, quality and poster route", () => {
    expect(find("movie-1")).toMatchObject({
      title: "Starfall",
      detail: "2026",
      quality: "WEBDL-1080p",
      posterSrc: "/api/movies/101/poster",
      href: "/movies/101",
    });
  });

  it("shows an episode with its code, title, series link and poster route", () => {
    expect(find("episode-1")).toMatchObject({
      title: "Harbour Lights",
      detail: "S02E05 · Tidewater",
      posterSrc: "/api/tv/201/poster",
      href: "/tv/201",
    });
  });

  it("gives a movie its year, the first three genres and the overview as its peek", () => {
    expect(find("movie-1").peek).toStrictEqual({
      year: 2026,
      genres: ["Thriller", "Drama", "Mystery"],
      overview: "A made-up film for tests.",
    });
  });

  it("gives an episode the series' year, genres and overview as its peek", () => {
    expect(find("episode-1").peek).toStrictEqual({
      year: 2021,
      genres: ["Drama", "Mystery"],
      overview: "A made-up show for tests.",
    });
  });

  it("gives a null peek when the movie or series is missing from the record", () => {
    expect(find("movie-7").peek).toBeNull();
    expect(find("episode-8").peek).toBeNull();
  });

  it("gives no poster when the included resource has none, and still links the series", () => {
    expect(find("movie-2").posterSrc).toBeNull();
    expect(find("episode-4")).toMatchObject({ posterSrc: null, href: "/tv/202" });
  });

  it("names a movie that is missing from the record, with no poster or detail", () => {
    expect(find("movie-7")).toMatchObject({ title: "Unknown movie", detail: "", posterSrc: null, href: null });
  });

  it("names a series that is missing, with no link, and shows TBA for an untitled episode", () => {
    expect(find("episode-8")).toMatchObject({
      title: "Unknown series",
      detail: "S00E01 · TBA",
      href: null,
      posterSrc: null,
    });
  });

  it("gives an unknown series and no episode an empty detail", () => {
    expect(find("episode-9")).toMatchObject({ title: "Unknown series", detail: "", href: null });
  });

  it("formats the time in the zone it is given", () => {
    expect(find("movie-1").when).toBe("2 Nov 2026, 14:05");
    expect(merged(100, "America/New_York").find((entry) => entry.key === "movie-1")?.when).toBe("2 Nov 2026, 09:05");
  });

  it("reads only the allowlisted details and formats them", () => {
    expect(find("movie-1").details).toEqual({
      sourceTitle: "Starfall.2026.1080p.WEB-DL.x264-GRP",
      indexer: "Indexer One",
      downloadClient: "SABnzbd",
      releaseGroup: "GRP",
      size: "1.5 GB",
      message: null,
      reason: null,
    });
    expect(find("episode-1").details.size).toBe("2.0 GB");
  });

  it("shows the message and reason when present, with the reason in words", () => {
    expect(find("movie-3").details.message).toBe("Download failed: unpacking error");
    expect(find("movie-4").details.reason).toBe("Missing from disk");
    expect(find("episode-5").details.reason).toBe("Upgraded");
    expect(find("movie-6").details.message).toBe("Release ignored by the user");
  });

  it("never lets the download URL, NZB info URL, API key or upstream host reach the output", () => {
    const text = JSON.stringify(merged());
    for (const forbidden of ["apikey", "downloadUrl", "nzbInfoUrl", "SECRET", "indexer.test", "getnzb"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("only sends the fields in HistoryEntry", () => {
    const expectedKeys = [
      "app",
      "canMarkFailed",
      "date",
      "detail",
      "details",
      "event",
      "historyId",
      "href",
      "key",
      "kind",
      "peek",
      "posterSrc",
      "quality",
      "title",
      "when",
    ];
    for (const entry of merged()) {
      expect(Object.keys(entry).sort()).toEqual(expectedKeys);
    }
  });
});

describe("radarrEventCodes and sonarrEventCodes", () => {
  it("maps the ticked categories to each app's integer codes", () => {
    expect(radarrEventCodes(["imported", "failed"])).toEqual([3, 7, 4]);
    expect(sonarrEventCodes(["imported", "failed"])).toEqual([2, 3, 4]);
    expect(radarrEventCodes(["renamed", "ignored"])).toEqual([8, 9]);
    expect(sonarrEventCodes(["deleted", "renamed", "ignored"])).toEqual([5, 6, 7]);
  });

  it("gives no codes when no category is ticked, so no filter is sent", () => {
    expect(radarrEventCodes([])).toEqual([]);
    expect(sonarrEventCodes([])).toEqual([]);
  });
});

describe("eventOf", () => {
  it("maps names it knows and gives unknown for everything else", () => {
    expect(eventOf("seriesFolderImported")).toBe("imported");
    expect(eventOf("episodeFileRenamed")).toBe("renamed");
    expect(eventOf("unknown")).toBe("unknown");
    expect(eventOf("constructor")).toBe("unknown");
    expect(eventOf(undefined)).toBe("unknown");
  });
});

describe("reasonText", () => {
  it("splits camelCase into lower-case words with a capital first letter", () => {
    expect(reasonText("MissingFromDisk")).toBe("Missing from disk");
    expect(reasonText("Upgraded")).toBe("Upgraded");
  });

  it("keeps acronyms in capitals", () => {
    expect(reasonText("HTTPError")).toBe("HTTP error");
  });

  it("gives null for empty text", () => {
    expect(reasonText("")).toBeNull();
    expect(reasonText("__")).toBeNull();
  });
});

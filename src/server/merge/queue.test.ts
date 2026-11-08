import "server-only";
import { describe, expect, it } from "vitest";
import type { components as RadarrComponents } from "../arr/generated/radarr";
import type { components as SonarrComponents } from "../arr/generated/sonarr";
import radarrFixture from "./__fixtures__/radarr-queue.json";
import sonarrFixture from "./__fixtures__/sonarr-queue.json";
import { firstQueuedId, toQueueRows, type QueueRow } from "./queue";

type MovieQueueItem = RadarrComponents["schemas"]["QueueResource"];
type EpisodeQueueItem = SonarrComponents["schemas"]["QueueResource"];

// The fixtures include malformed items on purpose, so they are cast rather than typed as upstream output.
const movieItems = radarrFixture as unknown as MovieQueueItem[];
const episodeItems = sonarrFixture as unknown as EpisodeQueueItem[];

const NOW = Date.parse("2026-11-02T12:00:00Z");

function rows(includeDetails = true): QueueRow[] {
  return toQueueRows(movieItems, episodeItems, NOW, { includeDetails });
}

function find(key: string, list = rows()): QueueRow {
  const row = list.find((candidate) => candidate.key === key);
  if (!row) throw new Error(`no row ${key}`);
  return row;
}

describe("toQueueRows Radarr rows", () => {
  it("has one row per valid item, skipping ids that are not positive integers and repeats", () => {
    const keys = rows().filter((row) => row.app === "radarr").map((row) => row.key).sort();
    expect(keys).toEqual(["radarr-1", "radarr-2", "radarr-3", "radarr-4", "radarr-5", "radarr-8"]);
  });

  it("uses the movie title and year, with fallbacks when they are missing", () => {
    expect(find("radarr-1")).toMatchObject({ kind: "movie", title: "Alpha", detail: "2001" });
    expect(find("radarr-2").detail).toBe("1999");
    expect(find("radarr-4")).toMatchObject({ title: "Unknown movie", detail: "" });
    expect(find("radarr-5")).toMatchObject({ title: "Unknown movie", href: null, posterSrc: null });
  });

  it("links and shows a poster only when the movie id is positive and a poster is included", () => {
    expect(find("radarr-1")).toMatchObject({ href: "/movies/1", posterSrc: "/api/movies/1/poster" });
    expect(find("radarr-2")).toMatchObject({ href: "/movies/2", posterSrc: null });
    expect(find("radarr-8")).toMatchObject({ href: null, posterSrc: null });
  });

  it("gives the queue id as the key suffix and the state from the item", () => {
    expect(find("radarr-3")).toMatchObject({
      app: "radarr",
      queueId: 3,
      state: "importBlocked",
      severity: "warning",
      progress: 100,
    });
    expect(find("radarr-1")).toMatchObject({ state: "downloading", severity: "ok", progress: 75, etaSeconds: 3600 });
  });
});

describe("toQueueRows Sonarr rows", () => {
  it("merges a season pack (one queue item per episode, one downloadId) into one row", () => {
    const pack = rows().filter((row) => row.title === "Delta Show");
    expect(pack).toHaveLength(1);
    expect(pack[0]).toMatchObject({
      key: "sonarr-101",
      app: "sonarr",
      queueId: 101,
      kind: "episodes",
      detail: "Season 1 · 3 episodes",
      href: "/tv/10",
      posterSrc: "/api/tv/10/poster",
    });
  });

  it("shows one episode as its code and title, with TBA when the title is missing", () => {
    expect(find("sonarr-201").detail).toBe("S02E05 · Five");
    expect(find("sonarr-301")).toMatchObject({ detail: "S01E01 · TBA", state: "delayed", severity: "ok" });
  });

  it("counts episodes across several seasons without naming a season", () => {
    expect(find("sonarr-401").detail).toBe("2 episodes");
  });

  it("gives an unknown series a fallback title and no link", () => {
    expect(find("sonarr-501")).toMatchObject({ title: "Unknown series", href: null, posterSrc: null, severity: "error" });
  });

  it("keeps a season pack's key when the order of its items changes", () => {
    const pack = episodeItems.filter((item) => item.title === "LEAK-RELEASE-PACK");
    const reversed = [...pack].reverse();
    const forward = toQueueRows([], pack, NOW, { includeDetails: false });
    const backward = toQueueRows([], reversed, NOW, { includeDetails: false });
    expect(forward.map((row) => row.key)).toEqual(["sonarr-101"]);
    expect(backward.map((row) => [row.key, row.queueId])).toEqual([["sonarr-101", 101]]);
  });

  it("keeps the key when the first listed item leaves the group, and moves to the next id only when the smallest leaves", () => {
    const pack = episodeItems.filter((item) => item.title === "LEAK-RELEASE-PACK"); // listed 103, 101, 102
    const withoutFirstListed = pack.slice(1); // drops 103, the first listed item
    expect(toQueueRows([], withoutFirstListed, NOW, { includeDetails: false }).map((row) => row.key)).toEqual(["sonarr-101"]);

    const withoutSmallest = pack.filter((item) => item.id !== 101); // drops 101, the smallest id
    expect(toQueueRows([], withoutSmallest, NOW, { includeDetails: false }).map((row) => row.key)).toEqual(["sonarr-102"]);
  });

  it("does not merge two series whose fallback download keys match", () => {
    const sameTitle = (id: number, seriesId: number) =>
      ({
        id,
        seriesId,
        episodeId: id,
        series: { id: seriesId, title: `Show ${seriesId}` },
        episode: { id, seasonNumber: 1, episodeNumber: 1, title: "Same" },
        title: "Same release title",
        size: 100,
        sizeleft: 50,
        status: "downloading",
        trackedDownloadStatus: "ok",
        trackedDownloadState: "downloading",
      }) as unknown as EpisodeQueueItem;
    const list = toQueueRows([], [sameTitle(1, 1), sameTitle(2, 2)], NOW, { includeDetails: false });
    expect(list.map((row) => row.key).sort()).toEqual(["sonarr-1", "sonarr-2"]);
  });
});

describe("toQueueRows details for admins", () => {
  it("includes the release facts, the client, indexer and protocol", () => {
    expect(find("radarr-1").details).toEqual({
      releaseTitle: "LEAK-RELEASE-ALPHA",
      quality: "Bluray-1080p",
      sizeBytes: 1000,
      downloadClient: "LEAK-CLIENT",
      indexer: "LEAK-INDEXER",
      protocol: "usenet",
    });
  });

  it("gives messages with the error text first, then the status message lines", () => {
    expect(find("sonarr-201").messages).toEqual(["LEAK-ERROR-ECHO", "Manual import required for this episode."]);
    expect(find("radarr-3").messages).toEqual(["Manual import required for this download."]);
  });

  it("never returns a download id or an output path", () => {
    const json = JSON.stringify(rows());
    expect(json).not.toContain("LEAK-DL");
    expect(json).not.toContain("/LEAK/path");
    expect(json).not.toContain("downloadId");
    expect(json).not.toContain("outputPath");
  });
});

describe("toQueueRows for requesters", () => {
  const requesterRows = rows(false);

  it("gives no messages and no details", () => {
    for (const row of requesterRows) {
      expect(row.messages).toEqual([]);
      expect(row.details).toBeNull();
    }
  });

  it("leaves out release names, clients, indexers, paths and download ids", () => {
    const json = JSON.stringify(requesterRows);
    expect(json).not.toContain("LEAK");
    expect(json).not.toContain("downloadId");
    expect(json).not.toContain("outputPath");
  });

  it("keeps the same rows and order as for admins", () => {
    expect(requesterRows.map((row) => row.key)).toEqual(rows().map((row) => row.key));
  });
});

describe("toQueueRows sort order", () => {
  it("sorts errors first, then warnings, then the rest by ETA (unknown last), then title, then key", () => {
    expect(rows().map((row) => row.key)).toEqual([
      "radarr-4",
      "sonarr-501",
      "radarr-3",
      "sonarr-201",
      "radarr-5",
      "radarr-1",
      "sonarr-101",
      "radarr-2",
      "sonarr-301",
      "sonarr-401",
      "radarr-8",
    ]);
  });
});

describe("toQueueRows series source", () => {
  it("takes the series from an item that has one when an earlier item's series is null", () => {
    const pack = [
      { id: 2, seriesId: 7, downloadId: "pack", series: null, episode: { id: 21, seasonNumber: 1, episodeNumber: 1 } },
      {
        id: 3,
        seriesId: 7,
        downloadId: "pack",
        series: { id: 7, title: "Real Series", images: [{ coverType: "poster" }] },
        episode: { id: 22, seasonNumber: 1, episodeNumber: 2 },
      },
    ] as unknown as EpisodeQueueItem[];
    const [row] = toQueueRows([], pack, NOW, { includeDetails: false });
    expect(row.title).toBe("Real Series");
    expect(row.posterSrc).toBe("/api/tv/7/poster");
  });
});

describe("toQueueRows peek", () => {
  it("gives a Radarr row its movie's year, genres and overview, with at most three genres", () => {
    expect(find("radarr-1").peek).toStrictEqual({
      year: 2001,
      genres: ["Drama", "Crime", "Mystery"],
      overview: "A made-up film for tests.",
    });
  });

  it("gives a Radarr row with only a year a peek with no genres or overview", () => {
    expect(find("radarr-2").peek).toStrictEqual({ year: 1999, genres: [], overview: "" });
  });

  it("gives a Sonarr season pack the series' peek, from the first item that has a series", () => {
    expect(find("sonarr-101").peek).toStrictEqual({
      year: 2020,
      genres: ["Drama"],
      overview: "A made-up show for tests.",
    });
  });

  it("gives null when the movie or series is missing from the item", () => {
    expect(find("radarr-5").peek).toBeNull();
    expect(find("sonarr-501").peek).toBeNull();
  });
});

describe("firstQueuedId", () => {
  it("returns the first of the given ids (in the order given) that is still in the queue", () => {
    // 101 has left the queue, so the next id of the pack is the one to use.
    const left = episodeItems.filter((item) => item.id !== 101);
    expect(firstQueuedId(left, [101, 102, 103])).toBe(102);
    expect(firstQueuedId(episodeItems, [103, 101])).toBe(103);
  });

  it("returns null when none of the ids is in the queue", () => {
    expect(firstQueuedId(episodeItems, [999, 1000])).toBeNull();
    expect(firstQueuedId([], [101])).toBeNull();
  });

  it("only matches the items it is given, so an id from the other app's queue never matches", () => {
    expect(firstQueuedId(movieItems, [101])).toBeNull();
    expect(firstQueuedId(episodeItems, [1])).toBeNull();
  });

  it("never matches an id that is not a positive integer", () => {
    expect(firstQueuedId(movieItems, [0, -7])).toBeNull();
  });
});

describe("toQueueRows queue ids", () => {
  it("gives a Radarr row its own id, and a season pack every id of its download, sorted", () => {
    expect(find("radarr-1").queueIds).toEqual([1]);
    expect(find("sonarr-101").queueIds).toEqual([101, 102, 103]);
    expect(find("sonarr-401").queueIds).toEqual([401, 402]);
  });
});

describe("toQueueRows queue ids for requesters", () => {
  it("leaves out the queue ids for requesters, so only admins get item ids", () => {
    const requesterRows = rows(false);
    expect(requesterRows.length).toBeGreaterThan(0);
    for (const row of requesterRows) expect(row.queueIds).toEqual([]);
    // The queue ids are still the same for admins on the same data.
    expect(rows(true).find((row) => row.key === "sonarr-101")?.queueIds).toEqual([101, 102, 103]);
  });
});

describe("toQueueRows canForceImport", () => {
  // The fixtures have no completed item, so these are built from fixture items with the status changed.
  const stuckMovie = { ...movieItems[0], id: 91, status: "completed", trackedDownloadStatus: "warning" } as MovieQueueItem;
  const packItem = (id: number, status: string, trackedDownloadStatus: string) =>
    ({ ...episodeItems[0], id, downloadId: "DL-GROUP", status, trackedDownloadStatus }) as EpisodeQueueItem;

  it("is true for an admin when a Radarr item is completed with a warning", () => {
    expect(toQueueRows([stuckMovie], [], NOW, { includeDetails: true })[0].canForceImport).toBe(true);
  });

  it("is false for a requester even when the item is completed with a warning", () => {
    expect(toQueueRows([stuckMovie], [], NOW, { includeDetails: false })[0].canForceImport).toBe(false);
  });

  it("is false when the item is only a warning, or completed without one", () => {
    const warningOnly = { ...stuckMovie, id: 92, status: "warning" } as MovieQueueItem;
    const completedOk = { ...stuckMovie, id: 93, trackedDownloadStatus: "ok" } as MovieQueueItem;
    expect(toQueueRows([warningOnly, completedOk], [], NOW, { includeDetails: true }).map((row) => row.canForceImport)).toEqual([
      false,
      false,
    ]);
  });

  it("is true for a Sonarr download when any of its items is completed with a warning", () => {
    const rowsOut = toQueueRows([], [packItem(501, "downloading", "ok"), packItem(502, "completed", "warning")], NOW, {
      includeDetails: true,
    });
    expect(rowsOut).toHaveLength(1);
    expect(rowsOut[0].canForceImport).toBe(true);
  });

  it("is false for an item without a download id, since the action can't scan it", () => {
    const noDownloadId = { ...stuckMovie, id: 94, downloadId: null } as MovieQueueItem;
    expect(toQueueRows([noDownloadId], [], NOW, { includeDetails: true })[0].canForceImport).toBe(false);
  });

  it("is false for a Sonarr download when no item is completed with a warning", () => {
    const rowsOut = toQueueRows([], [packItem(501, "downloading", "ok"), packItem(502, "warning", "warning")], NOW, {
      includeDetails: true,
    });
    expect(rowsOut[0].canForceImport).toBe(false);
  });
});

describe("toQueueRows replacing flag", () => {
  it("is false on every row when no download ids are given", () => {
    expect(rows().every((row) => row.replacing === false)).toBe(true);
  });

  it("is set only on the rows whose download id is in that app's set", () => {
    const list = toQueueRows(movieItems, episodeItems, NOW, {
      includeDetails: true,
      replacing: { radarr: new Set(["LEAK-DL-ALPHA"]), sonarr: new Set(["LEAK-DL-PACK"]) },
    });
    expect(list.filter((row) => row.replacing).map((row) => row.key).sort()).toEqual(["radarr-1", "sonarr-101"]);
  });

  it("does not match a download id under the other app", () => {
    const list = toQueueRows(movieItems, episodeItems, NOW, {
      includeDetails: true,
      replacing: { radarr: new Set(["LEAK-DL-PACK"]), sonarr: new Set(["LEAK-DL-ALPHA"]) },
    });
    expect(list.some((row) => row.replacing)).toBe(false);
  });
});

import "server-only";
import { describe, expect, it } from "vitest";
import type { components as RadarrComponents } from "../arr/generated/radarr";
import type { components as SonarrComponents } from "../arr/generated/sonarr";
import radarrFixture from "./__fixtures__/radarr-queue.json";
import sonarrFixture from "./__fixtures__/sonarr-queue.json";
import { toQueueRows, type QueueRow } from "./queue";

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

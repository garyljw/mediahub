import "server-only";
import { describe, expect, it } from "vitest";
import type { EpisodeManualImportItem, MovieManualImportItem } from "../arr/manual-import";
import radarrFixture from "./__fixtures__/radarr-manualimport.json";
import sonarrFixture from "./__fixtures__/sonarr-manualimport.json";
import {
  canManualImport,
  pickEpisodeImportFiles,
  pickMovieImportFiles,
  toEpisodeImportCandidates,
  toMovieImportCandidates,
} from "./manual-import";

// The fixtures include an item with id 0 on purpose, so they are cast rather than typed as upstream output.
const movieItems = radarrFixture as unknown as MovieManualImportItem[];
const episodeItems = sonarrFixture as unknown as EpisodeManualImportItem[];

describe("toMovieImportCandidates", () => {
  const candidates = toMovieImportCandidates(movieItems);

  it("has one candidate per usable id, skipping id 0", () => {
    expect(candidates.map((candidate) => candidate.id)).toEqual([101, 102, 103, 104]);
  });

  it("names the file by its relative path, and matches it to the movie with its year", () => {
    expect(candidates[0]).toMatchObject({ name: "Alpha.2001.mkv", match: "Alpha (2001)", quality: "Bluray-1080p" });
    expect(candidates[1]).toMatchObject({ match: "Bravo (1999)", quality: "HD-720p" });
  });

  it("is unmatched when the scan has no movie, and marks it not importable", () => {
    expect(candidates[2]).toMatchObject({ name: "Alpha.Sample.mkv", match: null, importable: false, sizeBytes: 100 });
  });

  it("reports a zero size as null and not importable", () => {
    expect(candidates[3]).toMatchObject({ match: "Alpha (2001)", sizeBytes: null, importable: false });
  });

  it("de-duplicates and trims the rejection reasons, and drops blank ones", () => {
    expect(candidates[1].rejections).toEqual(["Existing file on disk is of equal or higher quality"]);
    expect(candidates[0].rejections).toEqual([]);
  });

  it("gives an importable file its movie as its target, and a non-importable one none", () => {
    expect(candidates[0].targets).toEqual(["movie-1"]);
    expect(candidates[2].targets).toEqual([]);
  });

  it("marks a movie file importable when Radarr would tick it", () => {
    expect(candidates[0].importable).toBe(true);
    expect(candidates[1].importable).toBe(true);
  });

  it("never includes the path, folder name or download id", () => {
    expect(JSON.stringify(candidates)).not.toContain("LEAK");
    expect(Object.keys(candidates[0]).sort()).toEqual(
      ["id", "match", "name", "quality", "rejections", "importable", "sizeBytes", "targets"].sort(),
    );
  });

  it("drops both items when two share an id, since the id is ambiguous", () => {
    const item = movieItems[0];
    expect(toMovieImportCandidates([item, { ...item, relativePath: "Other.mkv" }])).toEqual([]);
  });

  it("uses the name, then 'Unknown file', when there is no relative path", () => {
    const [named, unnamed] = toMovieImportCandidates([
      { ...movieItems[0], id: 301, relativePath: null, name: "  Plain  " },
      { ...movieItems[0], id: 302, relativePath: null, name: null },
    ]);
    expect(named.name).toBe("Plain");
    expect(unnamed.name).toBe("Unknown file");
  });

  it("leaves out the year when it is zero", () => {
    const [candidate] = toMovieImportCandidates([{ ...movieItems[0], id: 303, movie: { id: 1, title: "Zed", year: 0 } }]);
    expect(candidate.match).toBe("Zed");
  });
});

describe("toEpisodeImportCandidates", () => {
  const candidates = toEpisodeImportCandidates(episodeItems);

  it("has one candidate per item, in the order the scan lists them", () => {
    expect(candidates.map((candidate) => candidate.id)).toEqual([201, 202, 203, 204]);
  });

  it("matches a single episode with its code, and a two-episode file with both codes", () => {
    expect(candidates[0]).toMatchObject({ name: "Season 1/Delta.Show.S01E01.mkv", match: "Delta Show · S01E01" });
    expect(candidates[1].match).toBe("Delta Show · S01E02, S01E03");
    expect(candidates[1].targets).toEqual(["episode-1002", "episode-1003"]);
    expect(candidates[1].importable).toBe(true);
  });

  it("shows the series alone when the file has no episodes, and it isn't importable", () => {
    expect(candidates[2]).toMatchObject({ match: "Delta Show", importable: false });
  });

  it("reports a zero size as null and not importable", () => {
    expect(candidates[3]).toMatchObject({ sizeBytes: null, importable: false });
  });

  it("keeps the trimmed rejection reasons", () => {
    expect(candidates[1].rejections).toEqual(["Episode 1002 was already imported"]);
  });

  it("never includes the path, folder name or download id", () => {
    expect(JSON.stringify(candidates)).not.toContain("LEAK");
  });
});

describe("pickMovieImportFiles", () => {
  it("builds the command file from the scan's own fields, with the download id the server checked", () => {
    const result = pickMovieImportFiles(movieItems, [101], "DL-CHECKED");
    expect(result).toEqual({
      ok: true,
      files: [
        {
          path: "/LEAK/downloads/Alpha.2001.mkv",
          folderName: "LEAK-FOLDER",
          movieId: 1,
          quality: movieItems[0].quality,
          languages: [{ id: 1, name: "English" }],
          releaseGroup: "LEAK-GROUP",
          indexerFlags: 0,
          downloadId: "DL-CHECKED",
        },
      ],
    });
  });

  it("picks several files in the order given, without repeats", () => {
    const result = pickMovieImportFiles(movieItems, [102, 101, 102], "DL-CHECKED");
    expect(result.ok && result.files.map((file) => file.movieId)).toEqual([2, 1]);
  });

  it("says a file is missing when its id isn't in the scan, including ids that were skipped", () => {
    expect(pickMovieImportFiles(movieItems, [999], "DL-CHECKED")).toEqual({ ok: false, reason: "missing" });
    expect(pickMovieImportFiles(movieItems, [0], "DL-CHECKED")).toEqual({ ok: false, reason: "missing" });
  });

  it("says a file is not importable when it has no movie or a zero size", () => {
    expect(pickMovieImportFiles(movieItems, [101, 103], "DL-CHECKED")).toEqual({ ok: false, reason: "notImportable" });
    expect(pickMovieImportFiles(movieItems, [104], "DL-CHECKED")).toEqual({ ok: false, reason: "notImportable" });
  });

  it("refuses two picked files for the same movie", () => {
    const copy = { ...movieItems[0], id: 105, path: "/LEAK/downloads/copy.mkv" };
    expect(pickMovieImportFiles([...movieItems, copy], [101, 105], "DL-CHECKED")).toEqual({
      ok: false,
      reason: "duplicateTarget",
    });
  });

  it("treats an id shared by two scan items as missing", () => {
    const item = movieItems[0];
    expect(pickMovieImportFiles([item, { ...item }], [101], "DL-CHECKED")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("pickEpisodeImportFiles", () => {
  it("builds the command file with every episode id and the release type", () => {
    const result = pickEpisodeImportFiles(episodeItems, [202], "DL-CHECKED");
    expect(result).toEqual({
      ok: true,
      files: [
        {
          path: "/LEAK/downloads/Delta.Show.S01E02-E03.mkv",
          folderName: "LEAK-FOLDER",
          seriesId: 10,
          episodeIds: [1002, 1003],
          episodeFileId: null,
          quality: episodeItems[1].quality,
          languages: [{ id: 1, name: "English" }],
          releaseGroup: "LEAK-GROUP",
          indexerFlags: 0,
          releaseType: "multiEpisode",
          downloadId: "DL-CHECKED",
        },
      ],
    });
  });

  it("refuses two picked files that cover the same episode", () => {
    const copy = { ...episodeItems[0], id: 205, path: "/LEAK/downloads/copy.mkv" };
    expect(pickEpisodeImportFiles([...episodeItems, copy], [201, 205], "DL-CHECKED")).toEqual({
      ok: false,
      reason: "duplicateTarget",
    });
  });

  it("allows files that cover different episodes", () => {
    expect(pickEpisodeImportFiles(episodeItems, [201, 202], "DL-CHECKED").ok).toBe(true);
  });

  it("says a file is not importable when it has no episodes, and missing when its id is unknown", () => {
    expect(pickEpisodeImportFiles(episodeItems, [203], "DL-CHECKED")).toEqual({ ok: false, reason: "notImportable" });
    expect(pickEpisodeImportFiles(episodeItems, [404], "DL-CHECKED")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("canManualImport", () => {
  it("is true only for a completed download with a warning and a download id", () => {
    const base = { downloadId: "DL" };
    expect(canManualImport({ ...base, status: "completed", trackedDownloadStatus: "warning" })).toBe(true);
    expect(canManualImport({ ...base, status: "downloading", trackedDownloadStatus: "warning" })).toBe(false);
    expect(canManualImport({ ...base, status: "completed", trackedDownloadStatus: "ok" })).toBe(false);
    expect(canManualImport({ ...base, status: "completed", trackedDownloadStatus: "error" })).toBe(false);
  });

  it("is false without a non-blank download id, since the scan is asked for by download id", () => {
    expect(canManualImport({ status: "completed", trackedDownloadStatus: "warning" })).toBe(false);
    expect(canManualImport({ status: "completed", trackedDownloadStatus: "warning", downloadId: "  " })).toBe(false);
  });
});

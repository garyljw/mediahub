import { describe, expect, it } from "vitest";
import { clashingFiles, type ImportCandidate } from "./queue-import";

function file(id: number, targets: string[]): ImportCandidate {
  return { id, name: `f${id}`, match: null, quality: null, sizeBytes: 1, rejections: [], importable: true, targets };
}

describe("clashingFiles", () => {
  const files = [
    file(1, ["episode-10", "episode-11"]),
    file(2, ["episode-11"]),
    file(3, ["episode-12"]),
    file(4, ["movie-5"]),
    file(5, ["movie-5"]),
  ];

  it("returns every ticked file that shares a target with another ticked file", () => {
    expect([...clashingFiles(files, new Set([1, 2, 3, 4, 5]))].sort()).toEqual([1, 2, 4, 5]);
  });

  it("ignores unticked files", () => {
    expect(clashingFiles(files, new Set([1, 3, 4])).size).toBe(0);
  });

  it("doesn't count a target repeated within one file as a clash", () => {
    expect(clashingFiles([file(1, ["episode-1", "episode-1"])], new Set([1])).size).toBe(0);
  });
});

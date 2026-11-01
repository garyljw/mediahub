import "server-only";
import { describe, expect, it } from "vitest";
import { toRootFolderOptions } from "./root-folders";

describe("toRootFolderOptions", () => {
  it("skips entries without a numeric id or a path, sorts by path, and keeps free space", () => {
    const folders = [
      { id: 2, path: "/invented/movies-b", freeSpace: 500 },
      { id: 3, path: "", freeSpace: 1 },
      { path: "/invented/no-id", freeSpace: 2 },
      { id: 1, path: "/invented/movies-a" },
    ];
    expect(toRootFolderOptions(folders)).toEqual([
      { id: 1, path: "/invented/movies-a", freeSpace: null },
      { id: 2, path: "/invented/movies-b", freeSpace: 500 },
    ]);
  });
});

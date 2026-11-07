import "server-only";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noticesSummary, noticesText } from "./notices";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mh-notices-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("noticesSummary", () => {
  it("returns the parsed list, including an empty version", () => {
    writeFileSync(
      path.join(dir, "THIRD_PARTY_NOTICES.json"),
      JSON.stringify([
        { name: "next", version: "16.0.0", licence: "MIT" },
        { name: "WinSW", version: "", licence: "MIT" },
      ]),
    );
    expect(noticesSummary()).toEqual([
      { name: "next", version: "16.0.0", licence: "MIT" },
      { name: "WinSW", version: "", licence: "MIT" },
    ]);
  });

  it("returns null when the file is missing", () => {
    expect(noticesSummary()).toBeNull();
  });

  it("returns null when the file does not match the shape", () => {
    writeFileSync(path.join(dir, "THIRD_PARTY_NOTICES.json"), JSON.stringify([{ name: "next", version: 16, licence: "MIT" }]));
    expect(noticesSummary()).toBeNull();
    writeFileSync(path.join(dir, "THIRD_PARTY_NOTICES.json"), "{not json");
    expect(noticesSummary()).toBeNull();
    writeFileSync(path.join(dir, "THIRD_PARTY_NOTICES.json"), JSON.stringify({ name: "next" }));
    expect(noticesSummary()).toBeNull();
  });
});

describe("noticesText", () => {
  it("returns the text file", () => {
    writeFileSync(path.join(dir, "THIRD_PARTY_NOTICES.txt"), "THIRD-PARTY NOTICES\n");
    expect(noticesText()).toBe("THIRD-PARTY NOTICES\n");
  });

  it("returns null when the file is missing", () => {
    expect(noticesText()).toBeNull();
  });
});

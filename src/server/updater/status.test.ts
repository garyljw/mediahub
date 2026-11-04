import "server-only";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultStatus, readStatus, writeStatus } from "./status";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "updater-status-test-"));
  file = path.join(dir, "status.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("status file", () => {
  it("gives the defaults when the file is missing", () => {
    expect(readStatus(file, "1.0.0")).toEqual(defaultStatus("1.0.0"));
  });

  it("gives the defaults when the file is invalid", () => {
    writeFileSync(file, "{ nope");
    expect(readStatus(file, "1.0.0")).toEqual(defaultStatus("1.0.0"));
    writeFileSync(file, JSON.stringify({ state: "sleeping" }));
    expect(readStatus(file, "1.0.0")).toEqual(defaultStatus("1.0.0"));
  });

  it("round-trips a written status as stored", () => {
    const status = {
      ...defaultStatus("1.0.0"),
      lastNightlyDate: "2026-11-04",
      skipped: ["1.1.0"],
      lastResult: { kind: "up-to-date" as const, version: null, at: "2026-11-04T03:00:00.000Z", message: "x" },
    };
    writeStatus(file, status);
    expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
    expect(readStatus(file, "1.2.0")).toEqual(status);
  });
});

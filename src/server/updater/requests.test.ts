import "server-only";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { takeRequests } from "./requests";

let root: string;
let requests: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "updater-requests-test-"));
  requests = path.join(root, "requests");
  outside = path.join(root, "outside.txt");
  mkdirSync(requests);
  writeFileSync(outside, "keep me");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("takeRequests", () => {
  it("returns false for an empty folder", () => {
    expect(takeRequests(requests)).toBe(false);
  });

  it("returns false when the folder is missing", () => {
    expect(takeRequests(path.join(root, "missing"))).toBe(false);
  });

  it("removes files and reports the request", () => {
    writeFileSync(path.join(requests, "check-1"), "");
    writeFileSync(path.join(requests, "check-2"), "");
    expect(takeRequests(requests)).toBe(true);
    expect(existsSync(path.join(requests, "check-1"))).toBe(false);
    expect(takeRequests(requests)).toBe(false);
  });

  it("removes a symlink without touching its target", () => {
    try {
      symlinkSync(outside, path.join(requests, "link"));
    } catch {
      // Creating symlinks may need privileges on some systems. The test is skipped there.
      return;
    }
    expect(takeRequests(requests)).toBe(true);
    expect(existsSync(path.join(requests, "link"))).toBe(false);
    expect(readFileSync(outside, "utf8")).toBe("keep me");
  });

  it("removes an empty folder", () => {
    mkdirSync(path.join(requests, "empty-dir"));
    expect(takeRequests(requests)).toBe(true);
    expect(existsSync(path.join(requests, "empty-dir"))).toBe(false);
  });

  it("logs a failed removal and does not count it as a request", () => {
    const dir = path.join(requests, "full-dir");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "inside"), "");
    const logged: string[] = [];
    expect(takeRequests(requests, (message) => logged.push(message))).toBe(false);
    expect(logged.length).toBe(1);
  });
});

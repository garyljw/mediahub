import "server-only";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mediahub-version-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function load() {
  return (await import("./app-version")).appVersion;
}

describe("appVersion", () => {
  it("uses build-info.json's version, including a release-candidate tag", async () => {
    writeFileSync(path.join(dir, "build-info.json"), JSON.stringify({ version: "1.0.0-rc.2", node: "v26.0.0" }));
    expect((await load())()).toBe("1.0.0-rc.2");
  });

  it("falls back to package.json without build-info.json", async () => {
    expect((await load())()).toBe(pkg.version);
  });

  it("falls back to package.json when build-info.json holds an invalid version", async () => {
    writeFileSync(path.join(dir, "build-info.json"), JSON.stringify({ version: "../evil" }));
    expect((await load())()).toBe(pkg.version);
  });
});

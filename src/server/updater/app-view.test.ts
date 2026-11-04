import "server-only";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  MEDIAHUB_UPDATES_DIR: undefined as string | undefined,
  DISPLAY_TIMEZONE: "Europe/London",
}));

vi.mock("@/server/env", () => ({ env: () => config }));

import { APP_VERSION } from "@/server/app-version";
import { defaultStatus, type Status } from "./status";
import { getUpdatesView, requestUpdateCheck, toUpdatesView } from "./app-view";

const TZ = "Europe/London";

function status(overrides: Partial<Status> = {}): Status {
  return { ...defaultStatus("0.0.0"), ...overrides };
}

describe("toUpdatesView", () => {
  it("shows a latest version only when it is newer than the running one", () => {
    expect(toUpdatesView(status({ latestVersion: "1.0.1" }), "1.0.0", false, TZ).latestVersion).toBe("1.0.1");
    expect(toUpdatesView(status({ latestVersion: "1.0.0" }), "1.0.0", false, TZ).latestVersion).toBeNull();
    expect(toUpdatesView(status({ latestVersion: "0.9.0" }), "1.0.0", false, TZ).latestVersion).toBeNull();
    expect(toUpdatesView(status({ latestVersion: "not-a-version" }), "1.0.0", false, TZ).latestVersion).toBeNull();
    expect(toUpdatesView(status({ latestVersion: null }), "1.0.0", false, TZ).latestVersion).toBeNull();
  });

  it("formats the last check and the last result in the display time zone", () => {
    const iso = "2026-11-02T03:30:00Z";
    const view = toUpdatesView(
      status({
        lastCheckAt: iso,
        lastResult: { kind: "installed", version: "1.0.1", at: iso, message: "Installed 1.0.1." },
      }),
      "1.0.0",
      false,
      TZ,
    );
    expect(view.lastChecked).toBe("2 Nov 2026, 03:30");
    expect(view.lastResult).toEqual({ kind: "installed", message: "Installed 1.0.1.", at: "2 Nov 2026, 03:30" });
  });

  it("returns null times and results when nothing has been checked", () => {
    const view = toUpdatesView(status(), "1.0.0", false, TZ);
    expect(view.lastChecked).toBeNull();
    expect(view.lastResult).toBeNull();
  });

  it("drops invalid skipped entries", () => {
    expect(toUpdatesView(status({ skipped: ["1.0.1", "junk"] }), "1.0.0", false, TZ).skipped).toEqual(["1.0.1"]);
  });

  it("passes only the fixed fields", () => {
    const view = toUpdatesView(status({ latestVersion: "1.0.1" }), "1.0.0", true, TZ);
    expect(Object.keys(view).sort()).toEqual(
      ["available", "checkQueued", "lastChecked", "lastResult", "latestVersion", "runningVersion", "skipped", "state"].sort(),
    );
    expect(view.available).toBe(true);
    expect(view.runningVersion).toBe("1.0.0");
    expect(view.checkQueued).toBe(true);
  });
});

describe("file-backed view and request", () => {
  let root: string;
  let requests: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "updater-app-view-test-"));
    requests = path.join(root, "requests");
    mkdirSync(requests);
    config.MEDIAHUB_UPDATES_DIR = root;
  });

  afterEach(() => {
    config.MEDIAHUB_UPDATES_DIR = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it("getUpdatesView is unavailable when the updates folder is not set", () => {
    config.MEDIAHUB_UPDATES_DIR = undefined;
    expect(getUpdatesView()).toEqual({ available: false, runningVersion: APP_VERSION });
  });

  it("getUpdatesView reads the status file and the queue", () => {
    writeFileSync(path.join(root, "status.json"), JSON.stringify(status({ latestVersion: "9.9.9" })));
    writeFileSync(path.join(requests, "check-test"), "");
    const view = getUpdatesView();
    expect(view).toMatchObject({ available: true, runningVersion: APP_VERSION, latestVersion: "9.9.9", checkQueued: true });
  });

  it("requestUpdateCheck is unavailable when the updates folder is not set", () => {
    config.MEDIAHUB_UPDATES_DIR = undefined;
    expect(requestUpdateCheck()).toBe("unavailable");
  });

  it("requestUpdateCheck creates exactly one empty check entry", () => {
    expect(requestUpdateCheck()).toBe("queued");
    const names = readdirSync(requests);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^check-/);
    expect(readFileSync(path.join(requests, names[0]), "utf8")).toBe("");
  });

  it("requestUpdateCheck does not add a second entry when one is already queued", () => {
    writeFileSync(path.join(requests, "check-existing"), "");
    expect(requestUpdateCheck()).toBe("already-queued");
    expect(readdirSync(requests)).toEqual(["check-existing"]);
    expect(existsSync(path.join(requests, "check-existing"))).toBe(true);
  });
});

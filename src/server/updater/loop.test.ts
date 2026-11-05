import "server-only";
import { describe, expect, it } from "vitest";
import { childEnv, shouldRunStage1 } from "./loop";

describe("shouldRunStage1", () => {
  const at = (hour: number, minute = 0) => new Date(2026, 10, 4, hour, minute);
  const base = { hasRequest: false, running: false, startup: false, nightlyRanOn: null };

  it("runs in the nightly hour once per night", () => {
    expect(shouldRunStage1({ ...base, now: at(3, 0) })).toBe(true);
    expect(shouldRunStage1({ ...base, now: at(3, 59) })).toBe(true);
    expect(shouldRunStage1({ ...base, now: at(3, 1), nightlyRanOn: "2026-11-04" })).toBe(false);
    expect(shouldRunStage1({ ...base, now: at(3, 1), nightlyRanOn: "2026-11-03" })).toBe(true);
  });

  it("does not run outside the nightly hour without a request", () => {
    expect(shouldRunStage1({ ...base, now: at(2, 59) })).toBe(false);
    expect(shouldRunStage1({ ...base, now: at(4, 0) })).toBe(false);
  });

  it("runs on a request at any hour, even after tonight's run", () => {
    expect(shouldRunStage1({ ...base, now: at(14, 20), hasRequest: true })).toBe(true);
    expect(shouldRunStage1({ ...base, now: at(3, 30), hasRequest: true, nightlyRanOn: "2026-11-04" })).toBe(true);
  });

  it("runs once at startup, at any hour", () => {
    expect(shouldRunStage1({ ...base, now: at(14, 20), startup: true })).toBe(true);
  });

  it("never runs while a stage 1 is still running", () => {
    expect(shouldRunStage1({ ...base, now: at(3, 0), hasRequest: true, running: true })).toBe(false);
    expect(shouldRunStage1({ ...base, now: at(14, 0), startup: true, running: true })).toBe(false);
  });
});

describe("childEnv", () => {
  it("removes every variable the env file sets, and keeps the rest", () => {
    const parent = {
      PATH: "C:\\Windows",
      MEDIAHUB_AUTO_UPDATE: "true",
      MEDIAHUB_UPDATES_DIR: "C:\\ProgramData\\MediaHub\\updates",
      SystemRoot: "C:\\Windows",
    };
    const text = "# settings\nMEDIAHUB_AUTO_UPDATE=false\nDISPLAY_TIMEZONE=Example/Zone\n";
    expect(childEnv(parent, text)).toEqual({
      PATH: "C:\\Windows",
      MEDIAHUB_UPDATES_DIR: "C:\\ProgramData\\MediaHub\\updates",
      SystemRoot: "C:\\Windows",
    });
  });

  it("drops a variable whose name differs only in case", () => {
    const parent = { mediahub_auto_update: "true", PATH: "x" };
    expect(childEnv(parent, "MEDIAHUB_AUTO_UPDATE=false")).toEqual({ PATH: "x" });
  });

  it("does not change the parent environment", () => {
    const parent = { MEDIAHUB_AUTO_UPDATE: "true" };
    childEnv(parent, "MEDIAHUB_AUTO_UPDATE=false");
    expect(parent).toEqual({ MEDIAHUB_AUTO_UPDATE: "true" });
  });

  it("returns a copy of the whole environment when the file is empty", () => {
    expect(childEnv({ A: "1", B: "2" }, "")).toEqual({ A: "1", B: "2" });
  });
});

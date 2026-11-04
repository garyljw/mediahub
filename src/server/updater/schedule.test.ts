import "server-only";
import { describe, expect, it } from "vitest";
import { decide, localDate } from "./schedule";

// Local-time constructors, so the tests hold in any time zone.
const at = (hour: number, day = 4) => new Date(2026, 10, day, hour, 30);

describe("decide", () => {
  it("runs the nightly check in the 03:00 hour only", () => {
    expect(decide({ now: at(3), lastNightlyDate: null, autoUpdate: true, hasRequest: false, lastCheckAt: null })).toEqual({
      check: true,
      manual: false,
      nightlyDate: "2026-11-04",
    });
    expect(decide({ now: at(2), lastNightlyDate: null, autoUpdate: true, hasRequest: false, lastCheckAt: null }).check).toBe(false);
    expect(decide({ now: at(4), lastNightlyDate: null, autoUpdate: true, hasRequest: false, lastCheckAt: null }).check).toBe(false);
  });

  it("runs the nightly check once per local date", () => {
    expect(decide({ now: at(3), lastNightlyDate: "2026-11-04", autoUpdate: true, hasRequest: false, lastCheckAt: null }).check).toBe(false);
    expect(decide({ now: at(3), lastNightlyDate: "2026-11-03", autoUpdate: true, hasRequest: false, lastCheckAt: null }).check).toBe(true);
  });

  it("does nothing overnight when auto-update is off", () => {
    expect(decide({ now: at(3), lastNightlyDate: null, autoUpdate: false, hasRequest: false, lastCheckAt: null }).check).toBe(false);
  });

  it("a request checks, and is manual", () => {
    expect(decide({ now: at(12), lastNightlyDate: "2026-11-04", autoUpdate: false, hasRequest: true, lastCheckAt: null })).toEqual({
      check: true,
      manual: true,
      nightlyDate: null,
    });
  });

  it("drops a request that comes within two minutes of the last check", () => {
    const now = at(12);
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
    const base = { now, lastNightlyDate: null, autoUpdate: true, hasRequest: true };
    expect(decide({ ...base, lastCheckAt: ago(1) }).check).toBe(false);
    expect(decide({ ...base, lastCheckAt: ago(2) })).toEqual({ check: true, manual: true, nightlyDate: null });
  });

  it("retries the nightly check at most every ten minutes", () => {
    const now = at(3);
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
    const base = { now, lastNightlyDate: "2026-11-03", autoUpdate: true, hasRequest: false };
    expect(decide({ ...base, lastCheckAt: ago(9) }).check).toBe(false);
    expect(decide({ ...base, lastCheckAt: ago(10) }).check).toBe(true);
    expect(decide({ ...base, lastCheckAt: "not a date" }).check).toBe(true);
  });

  it("uses the local date", () => {
    expect(localDate(new Date(2026, 0, 9, 23, 59))).toBe("2026-01-09");
  });
});

import "server-only";
import { describe, expect, it } from "vitest";
import { formatLocalDateTime } from "./local-time";

describe("formatLocalDateTime", () => {
  it("shows GMT in winter as the same clock time as UTC", () => {
    expect(formatLocalDateTime("2026-11-02T14:05:00Z", "Europe/London")).toBe("2 Nov 2026, 14:05");
  });

  it("adds an hour for BST in summer", () => {
    expect(formatLocalDateTime("2026-07-14T14:05:00Z", "Europe/London")).toBe("14 Jul 2026, 15:05");
  });

  it("rolls over to the next day near midnight in BST", () => {
    // 23:30 UTC on 14 Jul is 00:30 on 15 Jul in London.
    expect(formatLocalDateTime("2026-07-14T23:30:00Z", "Europe/London")).toBe("15 Jul 2026, 00:30");
  });

  it("uses midnight as 00 rather than 24", () => {
    expect(formatLocalDateTime("2026-01-05T00:00:00Z", "Europe/London")).toBe("5 Jan 2026, 00:00");
  });

  it("shows an em dash for an unparseable time", () => {
    expect(formatLocalDateTime("not a date", "Europe/London")).toBe("—");
  });

  it("shows an em dash for an unknown time zone", () => {
    expect(formatLocalDateTime("2026-11-02T14:05:00Z", "Not/AZone")).toBe("—");
  });

  it("uses the zone it is given", () => {
    // 14:05 UTC in November is 09:05 in New York (EST, -5h).
    expect(formatLocalDateTime("2026-11-02T14:05:00Z", "America/New_York")).toBe("2 Nov 2026, 09:05");
  });
});

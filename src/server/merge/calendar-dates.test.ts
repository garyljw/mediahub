import "server-only";
import { describe, expect, it } from "vitest";
import {
  CALENDAR_DAYS,
  addDays,
  daysFrom,
  defaultFrom,
  isCalendarDate,
  lastDayOf,
  mondayOf,
  resolveFrom,
  utcDateOf,
} from "./calendar-dates";

// 2026-11-02 is a Monday. Used as "today" for the default-range tests.
const TODAY = "2026-11-02";

describe("isCalendarDate", () => {
  it("accepts real dates in YYYY-MM-DD form", () => {
    expect(isCalendarDate("2026-11-02")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
  });

  it("rejects impossible dates and other shapes", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2025-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-11-2")).toBe(false);
    expect(isCalendarDate("2026-11-02T00:00:00Z")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("addDays and mondayOf", () => {
  it("moves across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the Monday on or before any day", () => {
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
  });
});

describe("defaultFrom", () => {
  it("is the Monday of the week before the current one", () => {
    expect(defaultFrom(TODAY)).toBe("2026-10-26");
    expect(defaultFrom("2026-11-08")).toBe("2026-10-26");
    expect(defaultFrom("2026-11-01")).toBe("2026-10-19");
  });
});

describe("daysFrom and lastDayOf", () => {
  it("lists five weeks, starting on the given day", () => {
    const days = daysFrom("2026-10-26");
    expect(days).toHaveLength(CALENDAR_DAYS);
    expect(days[0]).toBe("2026-10-26");
    expect(days[CALENDAR_DAYS - 1]).toBe("2026-11-29");
    expect(lastDayOf("2026-10-26")).toBe("2026-11-29");
  });

  it("ends on a Sunday", () => {
    expect(new Date(Date.parse(`${lastDayOf("2026-10-26")}T00:00:00Z`)).getUTCDay()).toBe(0);
  });
});

describe("utcDateOf", () => {
  it("gives the UTC calendar date of a point in time", () => {
    expect(utcDateOf(Date.parse("2026-11-02T23:30:00Z"))).toBe("2026-11-02");
    expect(utcDateOf(Date.parse("2026-11-03T00:30:00+02:00"))).toBe("2026-11-02");
  });
});

describe("resolveFrom", () => {
  it("accepts a Monday in range", () => {
    expect(resolveFrom("2026-11-09", TODAY)).toBe("2026-11-09");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a date", "soon"],
    ["an impossible date", "2026-02-30"],
    ["not a Monday", "2026-11-03"],
    ["a repeated parameter", ["2026-11-09", "2026-11-16"]],
    ["before 2000", "1999-01-04"],
    ["after 2100", "2101-01-04"],
  ])("falls back to the default for %s", (_label, value) => {
    expect(resolveFrom(value, TODAY)).toBe("2026-10-26");
  });
});

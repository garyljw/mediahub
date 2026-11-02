import { describe, expect, it } from "vitest";
import { formatAdded, formatCount, formatDay, formatEta, formatGridDay, formatRange, formatSize } from "./format";

describe("formatSize", () => {
  it("shows an em dash for zero, negative or invalid sizes", () => {
    expect(formatSize(0)).toBe("—");
    expect(formatSize(-1)).toBe("—");
    expect(formatSize(Number.NaN)).toBe("—");
  });

  it("uses bytes with no decimals", () => {
    expect(formatSize(512)).toBe("512 B");
  });

  it("uses one decimal below 100 in a unit", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1610612736)).toBe("1.5 GB");
    expect(formatSize(12345678901)).toBe("11.5 GB");
  });

  it("drops the decimal at 100 or more in a unit", () => {
    expect(formatSize(500 * 1024 ** 3)).toBe("500 GB");
    expect(formatSize(2 * 1024 ** 4)).toBe("2.0 TB");
  });

  it("rolls over to the next unit when rounding reaches 1024", () => {
    expect(formatSize(1048500)).toBe("1.0 MB");
    expect(formatSize(1073700000)).toBe("1.0 GB");
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(Math.round(99.96 * 1024 ** 2))).toBe("100 MB");
  });
});

describe("formatAdded", () => {
  it("formats an ISO date as day, short month and year", () => {
    expect(formatAdded("2024-03-12T12:00:00Z")).toBe("12 Mar 2024");
  });

  it("shows an em dash when the date is missing or unparseable", () => {
    expect(formatAdded(null)).toBe("—");
    expect(formatAdded("not a date")).toBe("—");
  });
});

describe("formatAdded month names", () => {
  it("uses fixed three-letter months, so server and browser render identical text", () => {
    // Node's ICU gave "5 Sept 2026" for en-GB while Safari gave "5 Sep 2026", causing a hydration error.
    expect(formatAdded("2026-09-05T10:00:00Z")).toBe("5 Sep 2026");
    expect(formatAdded("2024-01-31T23:59:59Z")).toBe("31 Jan 2024");
    expect(formatAdded("2024-12-01T00:00:00Z")).toBe("1 Dec 2024");
  });

  it("uses UTC, so a late-evening time doesn't roll to the next day in one runtime only", () => {
    expect(formatAdded("2024-03-12T23:30:00-05:00")).toBe("13 Mar 2024");
  });
});

describe("formatCount", () => {
  it("groups thousands with commas", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(475)).toBe("475");
    expect(formatCount(2000)).toBe("2,000");
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

describe("formatEta", () => {
  it.each([
    [null, null],
    [0, null],
    [-30, null],
    [1, "<1m"],
    [59, "<1m"],
    [60, "1m"],
    [720, "12m"],
    [3599, "59m"],
    [3900, "1h 5m"],
    [86399, "23h 59m"],
    [90000, "1d 1h"],
    [2 * 86400 + 3 * 3600 + 40, "2d 3h"],
  ])("formats %j as %j", (seconds, expected) => {
    expect(formatEta(seconds)).toBe(expected);
  });
});

describe("formatDay", () => {
  it("gives the weekday, day and month, without a year", () => {
    expect(formatDay("2026-11-02")).toBe("Mon 2 Nov");
    expect(formatDay("2026-11-08")).toBe("Sun 8 Nov");
    expect(formatDay("2027-01-01")).toBe("Fri 1 Jan");
  });

  it("shows an em dash for an unparseable date", () => {
    expect(formatDay("not a date")).toBe("—");
  });
});

describe("formatRange", () => {
  it("gives one year at the end when both dates share a year", () => {
    expect(formatRange("2026-10-26", "2026-11-29")).toBe("26 Oct – 29 Nov 2026");
  });

  it("gives each side its own year when the range crosses New Year", () => {
    expect(formatRange("2026-12-28", "2027-01-31")).toBe("28 Dec 2026 – 31 Jan 2027");
  });

  it("shows an em dash for an unparseable date", () => {
    expect(formatRange("2026-10-26", "soon")).toBe("—");
  });
});

describe("formatGridDay", () => {
  it("gives only the day of the month for an ordinary day", () => {
    expect(formatGridDay("2026-11-28", false)).toBe("28");
    expect(formatGridDay("2026-11-03", false)).toBe("3");
  });

  it("adds the short month when asked", () => {
    expect(formatGridDay("2026-12-01", true)).toBe("1 Dec");
    expect(formatGridDay("2026-10-27", true)).toBe("27 Oct");
  });

  it("shows an em dash for an unparseable date", () => {
    expect(formatGridDay("not a date", false)).toBe("—");
  });
});

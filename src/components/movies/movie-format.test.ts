import { describe, expect, it } from "vitest";
import { formatAdded, formatSize } from "./movie-format";

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

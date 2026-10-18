import { describe, expect, it } from "vitest";
import { formatAge, formatPeers, grabbedMessage, releaseCountLine } from "./movie-release";

describe("formatAge", () => {
  it("shows a dash for missing, negative or non-finite ages", () => {
    expect(formatAge(null)).toBe("—");
    expect(formatAge(-1)).toBe("—");
    expect(formatAge(Number.NaN)).toBe("—");
    expect(formatAge(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("shows under an hour as <1h", () => {
    expect(formatAge(0)).toBe("<1h");
    expect(formatAge(0.99)).toBe("<1h");
  });

  it("shows hours below 48, rounded down", () => {
    expect(formatAge(1)).toBe("1h");
    expect(formatAge(30.9)).toBe("30h");
    expect(formatAge(47.9)).toBe("47h");
  });

  it("shows whole days from 48 hours, with a thousands separator", () => {
    expect(formatAge(48)).toBe("2d");
    expect(formatAge(50)).toBe("2d");
    expect(formatAge(4000)).toBe("166d");
    expect(formatAge(24 * 1500)).toBe("1,500d");
  });
});

describe("formatPeers", () => {
  it("shows a dash when both sides are missing", () => {
    expect(formatPeers(null, null)).toBe("—");
  });

  it("shows seeders and leechers with a slash", () => {
    expect(formatPeers(12, 3)).toBe("12/3");
    expect(formatPeers(1234, 0)).toBe("1,234/0");
  });

  it("marks a missing side with a question mark", () => {
    expect(formatPeers(null, 4)).toBe("?/4");
    expect(formatPeers(9, null)).toBe("9/?");
  });
});

describe("grabbedMessage", () => {
  it("names the release that was sent", () => {
    expect(grabbedMessage("Starfall.2019.1080p")).toBe('Sent "Starfall.2019.1080p" to the download client.');
  });
});

describe("releaseCountLine", () => {
  it("says none found for zero", () => {
    expect(releaseCountLine(0, 0)).toBe("No releases found.");
  });

  it("uses the singular for one release", () => {
    expect(releaseCountLine(1, 1)).toBe("1 release");
  });

  it("uses the plural and separators when everything is shown", () => {
    expect(releaseCountLine(12, 12)).toBe("12 releases");
    expect(releaseCountLine(200, 200)).toBe("200 releases");
  });

  it("says how many were cut when only the top ones are shown", () => {
    expect(releaseCountLine(200, 1234)).toBe("Showing the top 200 of 1,234 releases");
  });
});

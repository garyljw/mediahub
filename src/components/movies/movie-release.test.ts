import { describe, expect, it } from "vitest";
import type { ReleaseRow } from "@/server/arr/releases";
import {
  filterReleases,
  formatAge,
  formatPeers,
  grabbedMessage,
  parseProtocolFilter,
  releaseCountLine,
  releaseDetails,
} from "./movie-release";

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

describe("releaseDetails", () => {
  const base: ReleaseRow = {
    token: "t",
    title: "Some.Release",
    indexer: "NZBgeek",
    protocol: "usenet",
    quality: "Bluray-2160p",
    customFormats: [],
    customFormatScore: 120,
    size: 14_000_000_000,
    ageHours: 30.5,
    seeders: null,
    leechers: null,
    languages: [],
    approved: true,
    rejections: [],
  };

  it("lists quality, size, age, protocol, indexer and score in that order", () => {
    expect(releaseDetails(base)).toEqual(["Bluray-2160p", "13.0 GB", "30h old", "Usenet", "NZBgeek", "Score 120"]);
  });

  it("adds peers for torrents only", () => {
    expect(releaseDetails({ ...base, protocol: "torrent", seeders: 12, leechers: 3 })).toContain("12/3 peers");
    expect(releaseDetails(base).some((part) => part.endsWith("peers"))).toBe(false);
  });

  it("leaves out peers for a torrent that has no counts, and marks a missing side with ?", () => {
    expect(releaseDetails({ ...base, protocol: "torrent" }).some((part) => part.endsWith("peers"))).toBe(false);
    expect(releaseDetails({ ...base, protocol: "torrent", seeders: null, leechers: 4 })).toContain("?/4 peers");
  });

  it("leaves out missing values instead of showing dashes, but always shows the score", () => {
    const sparse = { ...base, quality: null, size: 0, ageHours: null, protocol: "unknown" as const, indexer: null, customFormatScore: 0 };
    expect(releaseDetails(sparse)).toEqual(["Score 0"]);
  });

  it("keeps the sign on a negative score", () => {
    expect(releaseDetails({ ...base, customFormatScore: -1500 })).toContain("Score -1,500");
  });
});

describe("filterReleases", () => {
  function row(token: string, protocol: ReleaseRow["protocol"]): ReleaseRow {
    return {
      token,
      title: token,
      indexer: null,
      protocol,
      quality: null,
      customFormats: [],
      customFormatScore: 0,
      size: 0,
      ageHours: null,
      seeders: null,
      leechers: null,
      languages: [],
      approved: true,
      rejections: [],
    };
  }
  const releases = [row("a", "torrent"), row("b", "usenet"), row("c", "unknown"), row("d", "torrent")];

  it("returns every release, unknown protocol included, for all", () => {
    expect(filterReleases(releases, "all")).toBe(releases);
  });

  it("keeps only the chosen protocol, in the original order", () => {
    expect(filterReleases(releases, "torrent").map((r) => r.token)).toEqual(["a", "d"]);
    expect(filterReleases(releases, "usenet").map((r) => r.token)).toEqual(["b"]);
  });
});

describe("releaseCountLine with a protocol", () => {
  it("names the protocol", () => {
    expect(releaseCountLine(0, 0, "torrent")).toBe("No torrent releases found.");
    expect(releaseCountLine(1, 1, "usenet")).toBe("1 Usenet release");
    expect(releaseCountLine(200, 300, "usenet")).toBe("Showing the top 200 of 300 Usenet releases");
  });
});

describe("parseProtocolFilter", () => {
  it("accepts the three options and falls back to all for anything else", () => {
    expect(parseProtocolFilter("usenet")).toBe("usenet");
    expect(parseProtocolFilter("torrent")).toBe("torrent");
    expect(parseProtocolFilter("all")).toBe("all");
    expect(parseProtocolFilter("unknown")).toBe("all");
  });
});

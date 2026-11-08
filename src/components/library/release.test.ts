import { describe, expect, it } from "vitest";
import type { ReleaseRow } from "@/server/arr/releases";
import {
  episodeCode,
  filterReleases,
  formatAge,
  formatPeers,
  grabbedMessage,
  parsePackFilter,
  parseProtocolFilter,
  parseReleaseSort,
  releaseCountLine,
  releaseDetails,
  releaseTotal,
  sortReleases,
  twoDigits,
} from "./release";

/** A usable release with the given fields. Only the fields a test cares about need overriding. */
function sample(token: string, fields: Partial<ReleaseRow> = {}): ReleaseRow {
  return {
    token,
    title: token,
    indexer: null,
    protocol: "usenet",
    quality: null,
    qualityWeight: 0,
    notInProfile: false,
    customFormats: [],
    customFormatScore: 0,
    size: 0,
    ageHours: null,
    seeders: null,
    leechers: null,
    languages: [],
    approved: true,
    rejections: [],
    episodes: null,
    fullSeason: false,
    ...fields,
  };
}

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

describe("twoDigits and episodeCode", () => {
  it("zero-pads to two digits and leaves longer numbers alone", () => {
    expect(twoDigits(0)).toBe("00");
    expect(twoDigits(5)).toBe("05");
    expect(twoDigits(12)).toBe("12");
    expect(twoDigits(105)).toBe("105");
  });

  it("builds the season and episode code", () => {
    expect(episodeCode(2, 5)).toBe("S02E05");
    expect(episodeCode(0, 1)).toBe("S00E01");
    expect(episodeCode(12, 105)).toBe("S12E105");
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

  it("names season packs when the pack filter is packs", () => {
    expect(releaseCountLine(0, 0, "all", "packs")).toBe("No season packs found.");
    expect(releaseCountLine(1, 1, "usenet", "packs")).toBe("1 Usenet season pack");
    expect(releaseCountLine(1000, 1200, "torrent", "packs")).toBe("Showing the top 1,000 of 1,200 torrent season packs");
  });

  it("names episode releases when the pack filter is episodes", () => {
    expect(releaseCountLine(0, 0, "all", "episodes")).toBe("No episode releases found.");
  });
});

describe("releaseDetails", () => {
  const base: ReleaseRow = {
    token: "t",
    title: "Some.Release",
    indexer: "NZBgeek",
    protocol: "usenet",
    quality: "Bluray-2160p",
    qualityWeight: 0,
    notInProfile: false,
    customFormats: [],
    customFormatScore: 120,
    size: 14_000_000_000,
    ageHours: 30.5,
    seeders: null,
    leechers: null,
    languages: [],
    approved: true,
    rejections: [],
    episodes: null,
    fullSeason: false,
  };

  it("lists quality, size, age, protocol, indexer and score in that order", () => {
    expect(releaseDetails(base)).toEqual(["Bluray-2160p", "13.0 GB", "30h old", "Usenet", "NZBgeek", "Score 120"]);
  });

  it("starts with the episodes for a TV release", () => {
    expect(releaseDetails({ ...base, episodes: "S02E05-E06" })).toEqual([
      "S02E05-E06",
      "Bluray-2160p",
      "13.0 GB",
      "30h old",
      "Usenet",
      "NZBgeek",
      "Score 120",
    ]);
    expect(releaseDetails({ ...base, episodes: "Season pack" })[0]).toBe("Season pack");
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
  const row = (token: string, protocol: ReleaseRow["protocol"], fullSeason = false) => sample(token, { protocol, fullSeason });
  const releases = [row("a", "torrent"), row("b", "usenet"), row("c", "unknown"), row("d", "torrent")];

  it("returns every release, unknown protocol included, for all", () => {
    expect(filterReleases(releases, "all")).toBe(releases);
  });

  it("keeps only the chosen protocol, in the original order", () => {
    expect(filterReleases(releases, "torrent").map((r) => r.token)).toEqual(["a", "d"]);
    expect(filterReleases(releases, "usenet").map((r) => r.token)).toEqual(["b"]);
  });

  it("filters by pack, in the original order, and combines with the protocol", () => {
    const mixed = [
      row("a", "torrent", true),
      row("b", "usenet", false),
      row("c", "unknown", true),
      row("d", "torrent", false),
      row("e", "torrent", true),
    ];
    expect(filterReleases(mixed, "all", "packs").map((r) => r.token)).toEqual(["a", "c", "e"]);
    expect(filterReleases(mixed, "all", "episodes").map((r) => r.token)).toEqual(["b", "d"]);
    expect(filterReleases(mixed, "torrent", "packs").map((r) => r.token)).toEqual(["a", "e"]);
    expect(filterReleases(mixed, "usenet", "episodes").map((r) => r.token)).toEqual(["b"]);
  });

  it("drops releases not in the profile only when asked, and combines with the other filters", () => {
    const list = [sample("a", { notInProfile: true }), sample("b", { protocol: "torrent" }), sample("c", { protocol: "torrent", notInProfile: true })];
    expect(filterReleases(list, "all", "all").map((r) => r.token)).toEqual(["a", "b", "c"]);
    expect(filterReleases(list, "all", "all", true).map((r) => r.token)).toEqual(["b"]);
    expect(filterReleases(list, "torrent", "all", true).map((r) => r.token)).toEqual(["b"]);
  });
});

describe("sortReleases", () => {
  it("returns the same array for the app's order", () => {
    const list = [sample("a"), sample("b")];
    expect(sortReleases(list, "app")).toBe(list);
  });

  it("never changes the input array, and returns a new one for every other order", () => {
    const list = [
      sample("a", { qualityWeight: 1, size: 1, ageHours: 1, seeders: 1, leechers: 1 }),
      sample("b", { qualityWeight: 2, size: 2, ageHours: 2, seeders: 2, leechers: 2 }),
    ];
    for (const sort of ["quality", "size", "age", "seeders"] as const) {
      const sorted = sortReleases(list, sort);
      expect(sorted).not.toBe(list);
      expect(list.map((r) => r.token)).toEqual(["a", "b"]);
    }
  });

  it("puts the best quality weight first, keeping the app's order for ties", () => {
    const list = [sample("a", { qualityWeight: 2 }), sample("b", { qualityWeight: 5 }), sample("c", { qualityWeight: 5 }), sample("d", { qualityWeight: 1 })];
    expect(sortReleases(list, "quality").map((r) => r.token)).toEqual(["b", "c", "a", "d"]);
  });

  it("puts the largest size first, keeping the app's order for ties", () => {
    const list = [sample("a", { size: 1 }), sample("b", { size: 5 }), sample("c", { size: 5 }), sample("d", { size: 0 })];
    expect(sortReleases(list, "size").map((r) => r.token)).toEqual(["b", "c", "a", "d"]);
  });

  it("puts the newest first, with no age last", () => {
    const list = [sample("a", { ageHours: 10 }), sample("b", { ageHours: null }), sample("c", { ageHours: 2 }), sample("d", { ageHours: 10 })];
    expect(sortReleases(list, "age").map((r) => r.token)).toEqual(["c", "a", "d", "b"]);
  });

  it("puts the most peers first, weighting seeders over leechers, with non-torrents last", () => {
    const list = [
      sample("a", { protocol: "torrent", seeders: 5, leechers: 0 }),
      sample("b", { protocol: "torrent", seeders: 5, leechers: 9 }),
      sample("c", { protocol: "usenet" }),
      sample("d", { protocol: "torrent", seeders: 12, leechers: 0 }),
      sample("e", { protocol: "torrent", seeders: 5, leechers: 0 }),
    ];
    expect(sortReleases(list, "seeders").map((r) => r.token)).toEqual(["d", "b", "a", "e", "c"]);
  });
});

describe("parseReleaseSort", () => {
  it("accepts the five options and falls back to best match for anything else, including null", () => {
    expect(parseReleaseSort("quality")).toBe("quality");
    expect(parseReleaseSort("seeders")).toBe("seeders");
    expect(parseReleaseSort("app")).toBe("app");
    expect(parseReleaseSort("name")).toBe("app");
    expect(parseReleaseSort(null)).toBe("app");
  });
});

describe("releaseTotal", () => {
  const totals = { all: 10, usenet: 6, torrent: 4, packs: { all: 3, usenet: 2, torrent: 1 } };

  it("gives the protocol total when every release is shown", () => {
    expect(releaseTotal(totals, "all", "all")).toBe(10);
    expect(releaseTotal(totals, "usenet", "all")).toBe(6);
  });

  it("gives the pack total, and episodes as the rest", () => {
    expect(releaseTotal(totals, "all", "packs")).toBe(3);
    expect(releaseTotal(totals, "all", "episodes")).toBe(7);
    expect(releaseTotal(totals, "torrent", "packs")).toBe(1);
    expect(releaseTotal(totals, "torrent", "episodes")).toBe(3);
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
  it("accepts the three options and falls back to all for anything else, including null", () => {
    expect(parseProtocolFilter("usenet")).toBe("usenet");
    expect(parseProtocolFilter("torrent")).toBe("torrent");
    expect(parseProtocolFilter("all")).toBe("all");
    expect(parseProtocolFilter("unknown")).toBe("all");
    expect(parseProtocolFilter(null)).toBe("all");
  });
});

describe("parsePackFilter", () => {
  it("accepts the three options and falls back to season packs for anything else, including null", () => {
    expect(parsePackFilter("packs")).toBe("packs");
    expect(parsePackFilter("episodes")).toBe("episodes");
    expect(parsePackFilter("all")).toBe("all");
    expect(parsePackFilter(null)).toBe("packs");
    expect(parsePackFilter("junk")).toBe("packs");
  });
});

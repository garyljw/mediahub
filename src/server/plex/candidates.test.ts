import "server-only";
import { describe, expect, it } from "vitest";
import type { PlexConnection } from "./client";
import { buildCandidates } from "./candidates";
import fixture from "./__fixtures__/server-connections.json";

const connections = fixture[0].connections as PlexConnection[];

describe("buildCandidates", () => {
  it("builds pinned https first, then plain http, from Gary's connection list", () => {
    expect(buildCandidates(connections)).toEqual([
      {
        id: "pinned-0",
        label: "https · 192.168.10.5:32400",
        url: "https://192-168-10-5.fakehash0123456789abcdef.plex.direct:32400",
        pinAddress: "192.168.10.5",
      },
      {
        id: "pinned-1",
        label: "https · [2001:db8::5]:32400",
        url: "https://2001-db8--5.fakehash0123456789abcdef.plex.direct:32400",
        pinAddress: "2001:db8::5",
      },
      {
        id: "http-2",
        label: "http · 192.168.10.5:32400 (not encrypted)",
        url: "http://192.168.10.5:32400",
        pinAddress: null,
      },
    ]);
  });

  it("never builds a plain http candidate for an IPv6 address", () => {
    const candidates = buildCandidates(connections);
    expect(candidates.some((c) => c.pinAddress === null && c.url.includes("::"))).toBe(false);
  });

  it("skips relay and non-local addresses", () => {
    const urls = buildCandidates(connections).map((c) => c.url);
    expect(urls.join(" ")).not.toContain("198");
    expect(urls.join(" ")).not.toContain("203.0.113.9");
  });

  it("skips an https address that is not on plex.direct", () => {
    const candidates = buildCandidates([
      { protocol: "https", address: "192.168.10.9", port: 32400, uri: "https://example.test:32400", local: true, relay: false, IPv6: false },
    ]);
    expect(candidates).toEqual([
      { id: "http-0", label: "http · 192.168.10.9:32400 (not encrypted)", url: "http://192.168.10.9:32400", pinAddress: null },
    ]);
  });

  it("removes duplicates by url and pin", () => {
    const one = connections[0];
    const candidates = buildCandidates([one, { ...one }]);
    expect(candidates.map((c) => c.id)).toEqual(["pinned-0", "http-1"]);
  });

  it("returns nothing for an empty or all-remote list", () => {
    expect(buildCandidates([])).toEqual([]);
    expect(buildCandidates(connections.filter((c) => !c.local))).toEqual([]);
  });

  it("skips a plex.direct address whose URL port differs from the listed port", () => {
    const candidates = buildCandidates([
      {
        protocol: "https",
        address: "192.168.10.5",
        port: 32400,
        uri: "https://192-168-10-5.fakehash0123456789abcdef.plex.direct:443",
        local: true,
        relay: false,
        IPv6: false,
      },
    ]);
    expect(candidates.map((candidate) => candidate.pinAddress)).toEqual([null]);
  });
});

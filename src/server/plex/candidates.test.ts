import "server-only";
import { describe, expect, it } from "vitest";
import type { PlexConnection } from "./client";
import { buildCandidates } from "./candidates";
import fixture from "./__fixtures__/server-connections.json";

const home = fixture[0];
const connections = home.connections as PlexConnection[];
const HOME = { serverName: "Fake Home Server" };

describe("buildCandidates", () => {
  it("builds pinned https first, then plain http, labelled with the server name", () => {
    expect(buildCandidates(connections, HOME)).toEqual([
      {
        id: "pinned-0",
        label: "Fake Home Server · https · 192.168.10.5:32400",
        url: "https://192-168-10-5.fakehash0123456789abcdef.plex.direct:32400",
        pinAddress: "192.168.10.5",
      },
      {
        id: "pinned-1",
        label: "Fake Home Server · https · [2001:db8::5]:32400",
        url: "https://2001-db8--5.fakehash0123456789abcdef.plex.direct:32400",
        pinAddress: "2001:db8::5",
      },
      {
        id: "http-2",
        label: "Fake Home Server · http · 192.168.10.5:32400 (not encrypted)",
        url: "http://192.168.10.5:32400",
        pinAddress: null,
      },
    ]);
  });


  it("never builds a plain http candidate for an IPv6 address", () => {
    const candidates = buildCandidates(connections, HOME);
    expect(candidates.some((c) => c.pinAddress === null && c.url.includes("::"))).toBe(false);
  });

  it("skips relay and non-local addresses", () => {
    const urls = buildCandidates(connections, HOME).map((c) => c.url);
    expect(urls.join(" ")).not.toContain("198");
    expect(urls.join(" ")).not.toContain("203.0.113.9");
  });

  it("skips an https address that is not on plex.direct", () => {
    const candidates = buildCandidates(
      [{ protocol: "https", address: "192.168.10.9", port: 32400, uri: "https://example.test:32400", local: true, relay: false, IPv6: false }],
      HOME,
    );
    expect(candidates).toEqual([
      {
        id: "http-0",
        label: "Fake Home Server · http · 192.168.10.9:32400 (not encrypted)",
        url: "http://192.168.10.9:32400",
        pinAddress: null,
      },
    ]);
  });

  it("removes duplicates by url and pin", () => {
    const one = connections[0];
    const candidates = buildCandidates([one, { ...one }], HOME);
    expect(candidates.map((c) => c.id)).toEqual(["pinned-0", "http-1"]);
  });

  it("returns nothing for an empty or all-remote list", () => {
    expect(buildCandidates([], HOME)).toEqual([]);
    expect(buildCandidates(connections.filter((c) => !c.local), HOME)).toEqual([]);
  });
});

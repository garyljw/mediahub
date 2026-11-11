import "server-only";
import { describe, expect, it } from "vitest";
import type { ArrDisk } from "../arr/disk-space";
import { mergeDisks } from "./disk-space";

const disk = (path: string, free = 100, total = 200, label: string | null = null): ArrDisk => ({
  path,
  label,
  freeSpace: free,
  totalSpace: total,
});

describe("mergeDisks", () => {
  it("shows a path both apps report once (ignoring case), with Radarr's numbers", () => {
    const { disks, unavailable } = mergeDisks([disk("C:\\", 50)], [disk("c:\\", 60)]);
    expect(disks).toEqual([disk("C:\\", 50)]);
    expect(unavailable).toEqual([]);
  });

  it("keeps different shares on the same server as separate rows", () => {
    const { disks } = mergeDisks(
      [disk("\\\\nas.example.test\\movies")],
      [disk("\\\\nas.example.test\\tv")],
    );
    expect(disks.map((d) => d.path)).toEqual(["\\\\nas.example.test\\movies", "\\\\nas.example.test\\tv"]);
  });

  it("sorts by path ignoring case", () => {
    const { disks } = mergeDisks([disk("d:\\"), disk("B:\\")], [disk("A:\\"), disk("C:\\")]);
    expect(disks.map((d) => d.path)).toEqual(["A:\\", "B:\\", "C:\\", "d:\\"]);
  });

  it("lists the app that couldn't be loaded and uses the other's disks", () => {
    expect(mergeDisks(null, [disk("C:\\")])).toEqual({ disks: [disk("C:\\")], unavailable: ["Radarr"] });
    expect(mergeDisks([disk("C:\\")], null)).toEqual({ disks: [disk("C:\\")], unavailable: ["Sonarr"] });
  });

  it("returns no disks and both apps unavailable when neither loaded", () => {
    expect(mergeDisks(null, null)).toEqual({ disks: [], unavailable: ["Radarr", "Sonarr"] });
  });
});

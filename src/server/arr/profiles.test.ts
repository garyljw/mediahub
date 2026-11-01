import "server-only";
import { describe, expect, it } from "vitest";
import { sortedProfileOptions, usableProfiles } from "./profiles";

describe("usableProfiles", () => {
  it("keeps only profiles with a numeric id and a non-empty name, in upstream order", () => {
    expect(
      usableProfiles([
        { id: 2, name: "Any" },
        { id: undefined, name: "No id" },
        { id: 3, name: "" },
        { id: 4, name: null },
        { id: 1, name: "HD-1080p" },
      ]),
    ).toEqual([
      { id: 2, name: "Any" },
      { id: 1, name: "HD-1080p" },
    ]);
  });
});

describe("sortedProfileOptions", () => {
  it("sorts by name with numbers compared as numbers", () => {
    expect(
      sortedProfileOptions([
        { id: 1, name: "Profile 10" },
        { id: 2, name: "Profile 2" },
        { id: 3, name: "Any" },
      ]),
    ).toEqual([
      { id: 3, name: "Any" },
      { id: 2, name: "Profile 2" },
      { id: 1, name: "Profile 10" },
    ]);
  });

  it("drops unusable profiles before sorting", () => {
    expect(sortedProfileOptions([{ id: 1, name: "B" }, { name: "A" }, { id: 2, name: "" }])).toEqual([{ id: 1, name: "B" }]);
  });
});

import "server-only";
import { describe, expect, it } from "vitest";
import { replaceableFileIds } from "./replace-import";
import fixture from "./__fixtures__/replace-import.json";

type Item = Parameters<typeof replaceableFileIds>[0][number];
const items = fixture as Item[];

describe("replaceableFileIds", () => {
  it("picks the files rejected only for not being an upgrade, for each of the three reasons", () => {
    // 1 is a plain upgrade reason, 2 is a quality revision, 3 is a Custom Format, and 11 is a movie file.
    expect(replaceableFileIds(items)).toEqual([1, 2, 3, 11]);
  });

  it("leaves out a file with another rejection, even if it also has an upgrade rejection", () => {
    expect(replaceableFileIds(items)).not.toContain(4);
    expect(replaceableFileIds(items)).not.toContain(5);
  });

  it("leaves out a file with no rejections, since the app would import it itself", () => {
    expect(replaceableFileIds(items)).not.toContain(6);
    expect(replaceableFileIds(items)).not.toContain(7);
  });

  it("leaves out ids that are not positive integers, and a blank rejection reason", () => {
    expect(replaceableFileIds(items)).not.toContain(0);
    expect(replaceableFileIds(items)).not.toContain(-3);
    expect(replaceableFileIds(items)).not.toContain(10);
  });

  it("needs a real prefix match, not a substring", () => {
    expect(
      replaceableFileIds([{ id: 20, rejections: [{ reason: "Reason: Not an upgrade for existing episode file(s)" }] }]),
    ).toEqual([]);
  });
});

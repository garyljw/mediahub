import "server-only";
import { describe, expect, it } from "vitest";
import { matchedByIdFileIds, replaceableFileIds } from "./replace-import";
import fixture from "./__fixtures__/replace-import.json";
import matchedFixture from "./__fixtures__/matched-by-id.json";

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

describe("matchedByIdFileIds", () => {
  type Scanned = Parameters<typeof matchedByIdFileIds>[0][number];
  const scanned = matchedFixture as Scanned[];

  it("picks the files with no rejections for the series, and leaves out a file with a rejection", () => {
    expect(matchedByIdFileIds(scanned, 10)).toEqual({ ok: true, ids: [1, 3, 4] });
  });

  it("refuses the whole download when any file is for another series, even one with a rejection", () => {
    expect(matchedByIdFileIds([...scanned, { id: 9, series: { id: 11 }, rejections: [{ reason: "Sample" }] }], 10)).toEqual({
      ok: false,
    });
  });

  it("refuses the whole download when a clean file is for another series", () => {
    expect(matchedByIdFileIds([...scanned, { id: 9, series: { id: 11 }, rejections: [] }], 10)).toEqual({ ok: false });
  });

  it("picks Radarr files by their movie id, and refuses a movie id that doesn't match", () => {
    const movieFiles = [{ id: 5, movie: { id: 20 }, rejections: [] }];
    expect(matchedByIdFileIds(movieFiles, 20)).toEqual({ ok: true, ids: [5] });
    expect(matchedByIdFileIds(movieFiles, 21)).toEqual({ ok: false });
  });

  it("leaves out a file with no series or movie, without refusing the download", () => {
    expect(matchedByIdFileIds([{ id: 6, rejections: [] }], 10)).toEqual({ ok: true, ids: [] });
  });

  it("leaves out a clean file whose id is not a positive integer", () => {
    expect(matchedByIdFileIds([{ id: 0, series: { id: 10 }, rejections: [] }, { id: -2, series: { id: 10 }, rejections: [] }], 10)).toEqual({
      ok: true,
      ids: [],
    });
  });

  it("returns an empty list for an empty scan", () => {
    expect(matchedByIdFileIds([], 10)).toEqual({ ok: true, ids: [] });
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses everything when the expected id is %s", (expectedId) => {
    expect(matchedByIdFileIds(scanned, expectedId)).toEqual({ ok: false });
  });
});

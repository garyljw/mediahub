import "server-only";
import { describe, expect, it } from "vitest";
import type { PlexItemKey } from "@/server/merge/watched";
import { collectionMoves, planFocusCollection } from "./focus-sync";

const key = (sectionKey: string, ratingKey: string): PlexItemKey => ({ sectionKey, ratingKey });

// Arr ids 1..4 are external ids 101..104. The index maps each external id to its Plex items.
const externalIds = new Map([
  [1, 101],
  [2, 102],
  [3, 103],
  [4, 104],
]);

describe("planFocusCollection", () => {
  it("lists the titles in list order from the one section that holds them", () => {
    const itemKeys = new Map([
      [101, [key("1", "11")]],
      [102, [key("1", "12")]],
      [103, [key("1", "13")]],
    ]);
    expect(planFocusCollection({ ids: [3, 1, 2], externalIds, itemKeys, storedSectionKey: null })).toEqual({
      sectionKey: "1",
      wanted: ["13", "11", "12"],
    });
  });

  it("leaves out a title that is not in Plex, and keeps the rest in order", () => {
    const itemKeys = new Map([
      [101, [key("1", "11")]],
      [103, [key("1", "13")]],
    ]);
    expect(planFocusCollection({ ids: [1, 2, 3], externalIds, itemKeys, storedSectionKey: null })).toEqual({
      sectionKey: "1",
      wanted: ["11", "13"],
    });
  });

  it("leaves out a title that has no external id", () => {
    const itemKeys = new Map([[101, [key("1", "11")]]]);
    expect(planFocusCollection({ ids: [9, 1], externalIds, itemKeys, storedSectionKey: null })).toEqual({
      sectionKey: "1",
      wanted: ["11"],
    });
  });

  it("picks the section that holds the most of the list's titles", () => {
    const itemKeys = new Map([
      [101, [key("1", "11")]],
      [102, [key("2", "21")]],
      [103, [key("2", "22")]],
    ]);
    expect(planFocusCollection({ ids: [1, 2, 3], externalIds, itemKeys, storedSectionKey: null })).toEqual({
      sectionKey: "2",
      wanted: ["21", "22"],
    });
  });

  it("breaks a tie with the stored section when it is one of the tied sections", () => {
    const itemKeys = new Map([
      [101, [key("1", "11")]],
      [102, [key("2", "21")]],
    ]);
    expect(planFocusCollection({ ids: [1, 2], externalIds, itemKeys, storedSectionKey: "2" })).toEqual({
      sectionKey: "2",
      wanted: ["21"],
    });
  });

  it("keeps the stored section while it holds any title, even when another section holds more", () => {
    const itemKeys = new Map([
      [101, [key("1", "11")]],
      [102, [key("2", "21")]],
      [103, [key("2", "22")]],
    ]);
    expect(planFocusCollection({ ids: [1, 2, 3], externalIds, itemKeys, storedSectionKey: "1" })).toEqual({
      sectionKey: "1",
      wanted: ["11"],
    });
  });

  it("breaks a tie with the lowest numeric section key when the stored section holds no title", () => {
    const itemKeys = new Map([
      [101, [key("10", "11")]],
      [102, [key("9", "21")]],
    ]);
    expect(planFocusCollection({ ids: [1, 2], externalIds, itemKeys, storedSectionKey: "3" })).toEqual({
      sectionKey: "9",
      wanted: ["21"],
    });
  });

  it("counts a title in two sections for both, and uses only the chosen section's item", () => {
    const itemKeys = new Map([
      [101, [key("1", "11"), key("2", "91")]],
      [102, [key("2", "21")]],
    ]);
    expect(planFocusCollection({ ids: [1, 2], externalIds, itemKeys, storedSectionKey: null })).toEqual({
      sectionKey: "2",
      wanted: ["91", "21"],
    });
  });

  it("takes the first item of a title in the chosen section", () => {
    const itemKeys = new Map([[101, [key("1", "11"), key("1", "12")]]]);
    expect(planFocusCollection({ ids: [1], externalIds, itemKeys, storedSectionKey: null })).toEqual({
      sectionKey: "1",
      wanted: ["11"],
    });
  });

  it("gives each rating key once when two titles resolve to the same item", () => {
    const itemKeys = new Map([
      [101, [key("1", "11")]],
      [102, [key("1", "11")]],
    ]);
    expect(planFocusCollection({ ids: [1, 2], externalIds, itemKeys, storedSectionKey: null })).toEqual({
      sectionKey: "1",
      wanted: ["11"],
    });
  });

  it("returns null when none of the titles is in Plex", () => {
    expect(planFocusCollection({ ids: [1, 2], externalIds, itemKeys: new Map(), storedSectionKey: "1" })).toBeNull();
  });
});

describe("collectionMoves", () => {
  it("gives no moves when the order already matches", () => {
    expect(collectionMoves(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
    expect(collectionMoves([], [])).toEqual([]);
  });

  it("moves one item to the front", () => {
    expect(collectionMoves(["a", "b", "c"], ["c", "a", "b"])).toEqual([{ itemKey: "c", after: null }]);
  });

  it("moves an item to the end by walking the list, which here takes two moves", () => {
    // The walk fixes index 0 first (b to the front), then index 1 (c after b). Each move is one Plex call.
    expect(collectionMoves(["a", "b", "c"], ["b", "c", "a"])).toEqual([
      { itemKey: "b", after: null },
      { itemKey: "c", after: "b" },
    ]);
    expect(applyMoves(["a", "b", "c"], collectionMoves(["a", "b", "c"], ["b", "c", "a"]))).toEqual(["b", "c", "a"]);
  });

  it("moves only what is needed for a swap of two neighbours", () => {
    expect(collectionMoves(["a", "b", "c"], ["a", "c", "b"])).toEqual([{ itemKey: "c", after: "a" }]);
  });

  it("reverses a whole list, and applying the moves in order gives the wanted order", () => {
    const actual = ["a", "b", "c", "d"];
    const wanted = ["d", "c", "b", "a"];
    const moves = collectionMoves(actual, wanted);
    expect(applyMoves(actual, moves)).toEqual(wanted);
  });

  it("gives the wanted order for a mixed reorder", () => {
    const actual = ["a", "b", "c", "d", "e"];
    const wanted = ["c", "e", "a", "d", "b"];
    expect(applyMoves(actual, collectionMoves(actual, wanted))).toEqual(wanted);
  });
});

/** Applies moves the way Plex does: an item goes straight after `after`, or to the front for null. */
function applyMoves(actual: string[], moves: { itemKey: string; after: string | null }[]): string[] {
  const list = [...actual];
  for (const { itemKey, after } of moves) {
    list.splice(list.indexOf(itemKey), 1);
    const at = after === null ? 0 : list.indexOf(after) + 1;
    list.splice(at, 0, itemKey);
  }
  return list;
}

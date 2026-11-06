import { describe, expect, it } from "vitest";
import { mergeVisibleOrder, moveInOrder } from "./focus-order";

describe("moveInOrder", () => {
  it("moves an id earlier and later", () => {
    expect(moveInOrder([1, 2, 3, 4], 4, 0)).toEqual([4, 1, 2, 3]);
    expect(moveInOrder([1, 2, 3, 4], 1, 2)).toEqual([2, 3, 1, 4]);
  });

  it("clamps the index and ignores an unknown id", () => {
    expect(moveInOrder([1, 2, 3], 2, 99)).toEqual([1, 3, 2]);
    expect(moveInOrder([1, 2, 3], 2, -5)).toEqual([2, 1, 3]);
    expect(moveInOrder([1, 2, 3], 9, 0)).toEqual([1, 2, 3]);
  });
});

describe("mergeVisibleOrder", () => {
  it("keeps hidden ids in their slots and reorders the visible ones", () => {
    // 2 is hidden (no longer in the library). Visible 1, 3, 4 become 4, 1, 3.
    expect(mergeVisibleOrder([1, 2, 3, 4], [1, 3, 4], [4, 1, 3])).toEqual([4, 2, 1, 3]);
  });

  it("returns the same order when nothing moved", () => {
    expect(mergeVisibleOrder([5, 6], [5, 6], [5, 6])).toEqual([5, 6]);
  });
});

import { describe, expect, it } from "vitest";
import { pruneSelection, selectAllState, toggleAllFiltered, toggleId } from "./selection";

const rows = (...ids: number[]) => ids.map((id) => ({ id }));

describe("toggleId", () => {
  it("adds a missing id and removes a present one, without mutating the input", () => {
    const start = new Set([1]);
    expect([...toggleId(start, 2)]).toEqual([1, 2]);
    expect([...toggleId(start, 1)]).toEqual([]);
    expect([...start]).toEqual([1]);
  });
});

describe("toggleAllFiltered and selectAllState", () => {
  const filtered = rows(10, 11, 12);

  it("selects every filtered row when none are selected", () => {
    expect(selectAllState(new Set(), filtered)).toBe("none");
    expect([...toggleAllFiltered(new Set(), filtered)].sort()).toEqual([10, 11, 12]);
  });

  it("selects the rest when some are selected, and reports the mixed state", () => {
    const selected = new Set([11]);
    expect(selectAllState(selected, filtered)).toBe("some");
    expect([...toggleAllFiltered(selected, filtered)].sort()).toEqual([10, 11, 12]);
  });

  it("clears the filtered rows when all are selected, and keeps ids outside the filter", () => {
    const selected = new Set([10, 11, 12, 99]);
    expect(selectAllState(selected, filtered)).toBe("all");
    expect([...toggleAllFiltered(selected, filtered)]).toEqual([99]);
  });

  it("only looks at the filtered list, not every selected id", () => {
    // 99 is selected but filtered out, so selecting all filtered is not "all".
    expect(selectAllState(new Set([99]), filtered)).toBe("none");
  });

  it("treats an empty filtered list as nothing to select", () => {
    expect(selectAllState(new Set([1]), [])).toBe("none");
    expect([...toggleAllFiltered(new Set([1]), [])]).toEqual([1]);
  });
});

describe("pruneSelection", () => {
  it("drops ids that are no longer in rows and keeps the rest", () => {
    expect([...pruneSelection(new Set([1, 2, 3]), rows(2, 3, 4))].sort()).toEqual([2, 3]);
  });

  it("returns the same ids when nothing was removed", () => {
    expect([...pruneSelection(new Set([1]), rows(1))]).toEqual([1]);
  });
});

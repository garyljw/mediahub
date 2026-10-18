import { describe, expect, it } from "vitest";
import {
  buildEditPayload,
  editTitle,
  pruneSelection,
  selectAllState,
  toggleAllFiltered,
  toggleId,
  updatedMessage,
} from "./movie-edit";

const rows = (...ids: number[]) => ids.map((id) => ({ id }));

describe("buildEditPayload", () => {
  it("sends only the fields that were changed", () => {
    expect(buildEditPayload([1, 2], 3, "keep")).toStrictEqual({ movieIds: [1, 2], qualityProfileId: 3 });
    expect(buildEditPayload([1], null, "monitored")).toStrictEqual({ movieIds: [1], monitored: true });
    expect(buildEditPayload([1], null, "unmonitored")).toStrictEqual({ movieIds: [1], monitored: false });
  });

  it("sends both fields when both were changed", () => {
    expect(buildEditPayload([5], 2, "unmonitored")).toStrictEqual({
      movieIds: [5],
      qualityProfileId: 2,
      monitored: false,
    });
  });

  it("returns null when everything is left at Keep current", () => {
    expect(buildEditPayload([1, 2], null, "keep")).toBeNull();
  });

  it("returns null when there are no movies, even if a change is set", () => {
    expect(buildEditPayload([], 2, "monitored")).toBeNull();
  });

  it("copies the ids, so later changes to the caller's array do not leak into the payload", () => {
    const ids = [1, 2];
    const payload = buildEditPayload(ids, null, "monitored");
    ids.push(3);
    expect(payload?.movieIds).toEqual([1, 2]);
  });
});

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

  it("selects every filtered movie when none are selected", () => {
    expect(selectAllState(new Set(), filtered)).toBe("none");
    expect([...toggleAllFiltered(new Set(), filtered)].sort()).toEqual([10, 11, 12]);
  });

  it("selects the rest when some are selected, and reports the mixed state", () => {
    const selected = new Set([11]);
    expect(selectAllState(selected, filtered)).toBe("some");
    expect([...toggleAllFiltered(selected, filtered)].sort()).toEqual([10, 11, 12]);
  });

  it("clears the filtered movies when all are selected, and keeps ids outside the filter", () => {
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

describe("messages", () => {
  it("uses the movie's title for a single edit and a count for a bulk edit", () => {
    expect(editTitle(1, "Starfall Protocol")).toBe("Starfall Protocol");
    expect(editTitle(3)).toBe("Edit 3 movies");
    expect(editTitle(1)).toBe("Edit 1 movie");
  });

  it("pluralises the success message", () => {
    expect(updatedMessage(1)).toBe("Updated 1 movie");
    expect(updatedMessage(4)).toBe("Updated 4 movies");
  });
});

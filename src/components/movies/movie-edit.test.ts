import { describe, expect, it } from "vitest";
import { buildEditPayload } from "./movie-edit";

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

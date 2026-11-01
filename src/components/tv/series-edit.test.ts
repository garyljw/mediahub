import { describe, expect, it } from "vitest";
import { MAX_EDIT_SERIES, buildEditPayload } from "./series-edit";

describe("buildEditPayload", () => {
  it("sends only the fields that were changed", () => {
    expect(buildEditPayload([1, 2], 3, "keep")).toStrictEqual({ seriesIds: [1, 2], qualityProfileId: 3 });
    expect(buildEditPayload([1], null, "monitored")).toStrictEqual({ seriesIds: [1], monitored: true });
    expect(buildEditPayload([1], null, "unmonitored")).toStrictEqual({ seriesIds: [1], monitored: false });
  });

  it("sends both fields when both were changed", () => {
    expect(buildEditPayload([5], 2, "unmonitored")).toStrictEqual({
      seriesIds: [5],
      qualityProfileId: 2,
      monitored: false,
    });
  });

  it("returns null when everything is left at Keep current", () => {
    expect(buildEditPayload([1, 2], null, "keep")).toBeNull();
  });

  it("returns null when there are no series, even if a change is set", () => {
    expect(buildEditPayload([], 2, "monitored")).toBeNull();
  });

  it("copies the ids, so later changes to the caller's array do not leak into the payload", () => {
    const ids = [1, 2];
    const payload = buildEditPayload(ids, null, "monitored");
    ids.push(3);
    expect(payload?.seriesIds).toEqual([1, 2]);
  });

  it("matches the server's limit", () => {
    expect(MAX_EDIT_SERIES).toBe(2000);
  });
});

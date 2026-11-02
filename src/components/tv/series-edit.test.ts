import { describe, expect, it } from "vitest";
import {
  NEW_ITEM_MONITOR_OPTIONS,
  buildSeriesEdit,
  isNewItemMonitor,
  isSeriesType,
  type SeriesFormValues,
} from "./series-edit";
import { SERIES_TYPE_LABELS, SERIES_TYPE_OPTIONS } from "./series-add";

const current: SeriesFormValues = {
  qualityProfileId: 1,
  monitored: true,
  seriesType: "standard",
  seasonFolder: true,
  monitorNewItems: "all",
};

describe("buildSeriesEdit", () => {
  it("returns null when nothing differs from the current values", () => {
    expect(buildSeriesEdit(10, current, { ...current })).toBeNull();
  });

  it("sends only the quality profile when only it changed", () => {
    expect(buildSeriesEdit(10, current, { ...current, qualityProfileId: 2 })).toStrictEqual({ seriesId: 10, qualityProfileId: 2 });
  });

  it("sends only the monitored flag when it changed, including a change to false", () => {
    expect(buildSeriesEdit(10, current, { ...current, monitored: false })).toStrictEqual({ seriesId: 10, monitored: false });
  });

  it("sends only the series type when it changed", () => {
    expect(buildSeriesEdit(10, current, { ...current, seriesType: "anime" })).toStrictEqual({ seriesId: 10, seriesType: "anime" });
  });

  it("sends a season folder change to false, which is a real change", () => {
    expect(buildSeriesEdit(10, current, { ...current, seasonFolder: false })).toStrictEqual({ seriesId: 10, seasonFolder: false });
  });

  it("sends only the new-season monitoring when it changed", () => {
    expect(buildSeriesEdit(10, current, { ...current, monitorNewItems: "none" })).toStrictEqual({
      seriesId: 10,
      monitorNewItems: "none",
    });
  });

  it("sends every changed field, and no others", () => {
    const edit = buildSeriesEdit(10, current, {
      qualityProfileId: 2,
      monitored: false,
      seriesType: "daily",
      seasonFolder: false,
      monitorNewItems: "none",
    });

    expect(edit).toStrictEqual({
      seriesId: 10,
      qualityProfileId: 2,
      monitored: false,
      seriesType: "daily",
      seasonFolder: false,
      monitorNewItems: "none",
    });
    expect(Object.keys(edit ?? {}).sort()).toEqual(
      ["monitorNewItems", "monitored", "qualityProfileId", "seasonFolder", "seriesId", "seriesType"].sort(),
    );
  });

  it("sends a chosen type and monitor value when the current ones are ones the form does not offer", () => {
    const unknown = { ...current, seriesType: null, monitorNewItems: null };

    expect(buildSeriesEdit(10, unknown, { ...unknown, seriesType: "anime", monitorNewItems: "none" })).toStrictEqual({
      seriesId: 10,
      seriesType: "anime",
      monitorNewItems: "none",
    });
  });

  it("never sends a null type or monitor value, so an unknown value is left alone", () => {
    const unknown = { ...current, seriesType: null, monitorNewItems: null };

    expect(buildSeriesEdit(10, unknown, unknown)).toBeNull();
    expect(buildSeriesEdit(10, unknown, { ...unknown, monitored: false })).toStrictEqual({ seriesId: 10, monitored: false });
  });

  it("uses the series id it is given", () => {
    expect(buildSeriesEdit(77, current, { ...current, seasonFolder: false })).toStrictEqual({ seriesId: 77, seasonFolder: false });
  });
});

describe("guards for values from Sonarr", () => {
  it("accepts the series types the form offers, and rejects anything else", () => {
    expect(SERIES_TYPE_OPTIONS.every((value) => isSeriesType(value))).toBe(true);
    for (const value of ["Anime", "weird", "", null, undefined]) expect(isSeriesType(value)).toBe(false);
  });

  it("accepts the new-season values the form offers, and rejects anything else", () => {
    expect(NEW_ITEM_MONITOR_OPTIONS.every((value) => isNewItemMonitor(value))).toBe(true);
    for (const value of ["future", "All", "", null, undefined]) expect(isNewItemMonitor(value)).toBe(false);
  });

  it("labels every series type", () => {
    expect(SERIES_TYPE_OPTIONS.map((value) => SERIES_TYPE_LABELS[value])).toEqual(["Standard", "Daily", "Anime"]);
  });
});

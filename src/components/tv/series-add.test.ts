import { describe, expect, it } from "vitest";
import { MONITOR_LABELS, SERIES_MONITOR_OPTIONS, SERIES_TYPE_LABELS, SERIES_TYPE_OPTIONS } from "./series-add";

describe("option labels", () => {
  it("has a label for every monitor and series type option, and no extra keys", () => {
    expect(SERIES_MONITOR_OPTIONS.map((option) => MONITOR_LABELS[option])).toEqual([
      "All episodes",
      "Future episodes",
      "Missing episodes",
      "Existing episodes",
      "First season",
      "Latest season",
      "None",
    ]);
    expect(Object.keys(MONITOR_LABELS).sort()).toEqual([...SERIES_MONITOR_OPTIONS].sort());
    expect(SERIES_TYPE_OPTIONS.map((option) => SERIES_TYPE_LABELS[option])).toEqual(["Standard", "Daily", "Anime"]);
  });
});

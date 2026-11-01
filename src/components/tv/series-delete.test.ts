import { describe, expect, it } from "vitest";
import { DELETE_LIST_LIMIT } from "@/components/movies/movie-delete";
import { confirmLabel, deleteTitle, deletedMessage, listedSeries, seriesLabel } from "./series-delete";

const seriesList = (count: number) => Array.from({ length: count }, (_, i) => ({ title: `Show ${i + 1}`, year: 2000 + i }));

describe("deleteTitle", () => {
  it("names a single series", () => {
    expect(deleteTitle([{ title: "Harbour Lights", year: 2018 }])).toBe("Delete Harbour Lights?");
  });

  it("counts several series", () => {
    expect(deleteTitle(seriesList(2))).toBe("Delete 2 series?");
  });
});

describe("seriesLabel", () => {
  it("adds the year when it is known, and leaves it out when it is not", () => {
    expect(seriesLabel({ title: "Harbour Lights", year: 2018 })).toBe("Harbour Lights (2018)");
    expect(seriesLabel({ title: "Ampersand & Co", year: null })).toBe("Ampersand & Co");
  });
});

describe("listedSeries", () => {
  it("lists every series when there are few", () => {
    expect(listedSeries(seriesList(2))).toEqual({ shown: ["Show 1 (2000)", "Show 2 (2001)"], more: null });
  });

  it("lists only the first limit and says how many more", () => {
    const result = listedSeries(seriesList(DELETE_LIST_LIMIT + 3));
    expect(result.shown).toHaveLength(DELETE_LIST_LIMIT);
    expect(result.more).toBe("and 3 more");
  });

  it("has no more line at exactly the limit", () => {
    expect(listedSeries(seriesList(DELETE_LIST_LIMIT)).more).toBeNull();
  });
});

describe("confirmLabel", () => {
  it("says series, with files when files are deleted too", () => {
    expect(confirmLabel(1, false)).toBe("Delete series");
    expect(confirmLabel(4, false)).toBe("Delete 4 series");
    expect(confirmLabel(1, true)).toBe("Delete series and files");
    expect(confirmLabel(4, true)).toBe("Delete 4 series and files");
  });
});

describe("deletedMessage", () => {
  it("uses the same word for one series and many", () => {
    expect(deletedMessage(1)).toBe("Deleted 1 series");
    expect(deletedMessage(2)).toBe("Deleted 2 series");
  });
});

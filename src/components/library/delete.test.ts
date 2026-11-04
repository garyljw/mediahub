import { describe, expect, it } from "vitest";
import { MOVIE, SERIES } from "./nouns";
import {
  DELETE_LIST_LIMIT,
  canConfirmDelete,
  confirmLabel,
  deleteTitle,
  itemLabel,
  listedItems,
  typedConfirmMatches,
} from "./delete";

const items = (count: number, word = "Movie") =>
  Array.from({ length: count }, (_, i) => ({ title: `${word} ${i + 1}`, year: 2000 + i }));

describe("deleteTitle", () => {
  it("names a single movie", () => {
    expect(deleteTitle([{ title: "Starfall Protocol", year: 2019 }], MOVIE)).toBe("Delete Starfall Protocol?");
  });

  it("counts several movies", () => {
    expect(deleteTitle(items(2), MOVIE)).toBe("Delete 2 movies?");
  });

  it("names a single series and counts several", () => {
    expect(deleteTitle([{ title: "Harbour Lights", year: 2018 }], SERIES)).toBe("Delete Harbour Lights?");
    expect(deleteTitle(items(2, "Show"), SERIES)).toBe("Delete 2 series?");
  });
});

describe("itemLabel", () => {
  it("adds the year when it is known, and leaves it out when it is not", () => {
    expect(itemLabel({ title: "Lantern Road", year: 2021 })).toBe("Lantern Road (2021)");
    expect(itemLabel({ title: "Ampersand & Co", year: null })).toBe("Ampersand & Co");
    expect(itemLabel({ title: "Harbour Lights", year: 2018 })).toBe("Harbour Lights (2018)");
  });
});

describe("listedItems", () => {
  it("lists every title and no 'more' line when there are at most 10", () => {
    const list = listedItems(items(DELETE_LIST_LIMIT));
    expect(list.shown).toHaveLength(10);
    expect(list.shown[0]).toBe("Movie 1 (2000)");
    expect(list.more).toBeNull();
  });

  it("lists the first 10 and says how many are left out", () => {
    const list = listedItems(items(13));
    expect(list.shown).toHaveLength(10);
    expect(list.shown.at(-1)).toBe("Movie 10 (2009)");
    expect(list.more).toBe("and 3 more");
  });

  it("says 'and 1 more' for 11 items", () => {
    expect(listedItems(items(11)).more).toBe("and 1 more");
  });

  it("lists nothing for an empty selection", () => {
    expect(listedItems([])).toEqual({ shown: [], more: null });
  });

  it("has no more line at exactly the limit, for series too", () => {
    expect(listedItems(items(DELETE_LIST_LIMIT, "Show")).more).toBeNull();
    const result = listedItems(items(DELETE_LIST_LIMIT + 3, "Show"));
    expect(result.shown).toHaveLength(DELETE_LIST_LIMIT);
    expect(result.more).toBe("and 3 more");
    expect(listedItems(items(2, "Show"))).toEqual({ shown: ["Show 1 (2000)", "Show 2 (2001)"], more: null });
  });
});

describe("confirmLabel", () => {
  it("uses the singular form for one movie", () => {
    expect(confirmLabel(1, false, MOVIE)).toBe("Delete movie");
    expect(confirmLabel(1, true, MOVIE)).toBe("Delete movie and files");
  });

  it("uses the plural form for several movies", () => {
    expect(confirmLabel(3, false, MOVIE)).toBe("Delete 3 movies");
    expect(confirmLabel(3, true, MOVIE)).toBe("Delete 3 movies and files");
  });

  it("says series, with files when files are deleted too", () => {
    expect(confirmLabel(1, false, SERIES)).toBe("Delete series");
    expect(confirmLabel(4, false, SERIES)).toBe("Delete 4 series");
    expect(confirmLabel(1, true, SERIES)).toBe("Delete series and files");
    expect(confirmLabel(4, true, SERIES)).toBe("Delete 4 series and files");
  });
});

describe("typedConfirmMatches", () => {
  it("accepts the word in any case, with surrounding spaces", () => {
    expect(typedConfirmMatches("delete")).toBe(true);
    expect(typedConfirmMatches("DELETE")).toBe(true);
    expect(typedConfirmMatches("  Delete \t")).toBe(true);
  });

  it("rejects anything else, including partial or empty text", () => {
    expect(typedConfirmMatches("")).toBe(false);
    expect(typedConfirmMatches("del")).toBe(false);
    expect(typedConfirmMatches("delete it")).toBe(false);
    expect(typedConfirmMatches("delete.")).toBe(false);
  });
});

describe("canConfirmDelete", () => {
  it("is enabled without deleting files, whatever is typed", () => {
    expect(canConfirmDelete(false, "")).toBe(true);
    expect(canConfirmDelete(false, "nope")).toBe(true);
  });

  it("needs the typed word when files are deleted", () => {
    expect(canConfirmDelete(true, "")).toBe(false);
    expect(canConfirmDelete(true, "dele")).toBe(false);
    expect(canConfirmDelete(true, " DELETE ")).toBe(true);
  });
});

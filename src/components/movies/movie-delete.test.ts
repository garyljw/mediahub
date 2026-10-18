import { describe, expect, it } from "vitest";
import {
  DELETE_LIST_LIMIT,
  canConfirmDelete,
  confirmLabel,
  deleteTitle,
  deletedMessage,
  listedMovies,
  movieLabel,
  typedConfirmMatches,
} from "./movie-delete";

const movies = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ title: `Movie ${i + 1}`, year: 2000 + i }));

describe("deleteTitle", () => {
  it("names a single movie", () => {
    expect(deleteTitle([{ title: "Starfall Protocol", year: 2019 }])).toBe("Delete Starfall Protocol?");
  });

  it("counts several movies", () => {
    expect(deleteTitle(movies(2))).toBe("Delete 2 movies?");
  });
});

describe("movieLabel", () => {
  it("adds the year when it is known, and leaves it out when it is not", () => {
    expect(movieLabel({ title: "Lantern Road", year: 2021 })).toBe("Lantern Road (2021)");
    expect(movieLabel({ title: "Ampersand & Co", year: null })).toBe("Ampersand & Co");
  });
});

describe("listedMovies", () => {
  it("lists every title and no 'more' line when there are at most 10", () => {
    const list = listedMovies(movies(DELETE_LIST_LIMIT));
    expect(list.shown).toHaveLength(10);
    expect(list.shown[0]).toBe("Movie 1 (2000)");
    expect(list.more).toBeNull();
  });

  it("lists the first 10 and says how many are left out", () => {
    const list = listedMovies(movies(13));
    expect(list.shown).toHaveLength(10);
    expect(list.shown.at(-1)).toBe("Movie 10 (2009)");
    expect(list.more).toBe("and 3 more");
  });

  it("says 'and 1 more' for 11 movies", () => {
    expect(listedMovies(movies(11)).more).toBe("and 1 more");
  });

  it("lists nothing for an empty selection", () => {
    expect(listedMovies([])).toEqual({ shown: [], more: null });
  });
});

describe("confirmLabel", () => {
  it("uses the singular form for one movie", () => {
    expect(confirmLabel(1, false)).toBe("Delete movie");
    expect(confirmLabel(1, true)).toBe("Delete movie and files");
  });

  it("uses the plural form for several movies", () => {
    expect(confirmLabel(3, false)).toBe("Delete 3 movies");
    expect(confirmLabel(3, true)).toBe("Delete 3 movies and files");
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

describe("deletedMessage", () => {
  it("reports the count in the right form", () => {
    expect(deletedMessage(1)).toBe("Deleted 1 movie");
    expect(deletedMessage(4)).toBe("Deleted 4 movies");
  });
});

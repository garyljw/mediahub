import { describe, expect, it } from "vitest";
import { MOVIE, SERIES } from "./nouns";
import { editTitle, updatedMessage } from "./edit";

describe("messages", () => {
  it("uses the movie's title for a single edit and a count for a bulk edit", () => {
    expect(editTitle(1, MOVIE, "Starfall Protocol")).toBe("Starfall Protocol");
    expect(editTitle(3, MOVIE)).toBe("Edit 3 movies");
    expect(editTitle(1, MOVIE)).toBe("Edit 1 movie");
  });

  it("pluralises the movie success message", () => {
    expect(updatedMessage(1, MOVIE)).toBe("Updated 1 movie");
    expect(updatedMessage(4, MOVIE)).toBe("Updated 4 movies");
  });
});

describe("series messages", () => {
  it("uses the series title for a single edit and a count for a bulk edit", () => {
    expect(editTitle(1, SERIES, "Harbour Lights")).toBe("Harbour Lights");
    expect(editTitle(1, SERIES)).toBe("Edit 1 series");
    expect(editTitle(3, SERIES)).toBe("Edit 3 series");
  });

  it("uses the same word for one series and many", () => {
    expect(updatedMessage(1, SERIES)).toBe("Updated 1 series");
    expect(updatedMessage(3, SERIES)).toBe("Updated 3 series");
  });
});

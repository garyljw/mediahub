import { describe, expect, it } from "vitest";
import { MOVIE, SERIES, countNoun } from "./nouns";

describe("countNoun", () => {
  it("uses the singular for one and the plural otherwise", () => {
    expect(countNoun(1, MOVIE)).toBe("1 movie");
    expect(countNoun(3, MOVIE)).toBe("3 movies");
  });

  it("uses the same word for one series and many", () => {
    expect(countNoun(1, SERIES)).toBe("1 series");
    expect(countNoun(3, SERIES)).toBe("3 series");
  });
});

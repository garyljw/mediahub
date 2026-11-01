import { describe, expect, it } from "vitest";
import { MAX_SEARCH_SERIES, searchStartedMessage } from "./series-search";

describe("searchStartedMessage", () => {
  it("uses the singular for one series", () => {
    expect(searchStartedMessage(1)).toBe("Started a search for 1 series");
  });

  it("uses the same word for several series", () => {
    expect(searchStartedMessage(3)).toBe("Started a search for 3 series");
  });
});

describe("MAX_SEARCH_SERIES", () => {
  it("is a positive whole number", () => {
    expect(Number.isInteger(MAX_SEARCH_SERIES)).toBe(true);
    expect(MAX_SEARCH_SERIES).toBeGreaterThan(0);
  });
});

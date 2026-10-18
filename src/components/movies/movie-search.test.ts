import { describe, expect, it } from "vitest";
import { MAX_SEARCH_MOVIES, searchStartedMessage } from "./movie-search";

describe("searchStartedMessage", () => {
  it("uses the singular for one movie", () => {
    expect(searchStartedMessage(1)).toBe("Started a search for 1 movie");
  });

  it("uses the plural otherwise", () => {
    expect(searchStartedMessage(3)).toBe("Started a search for 3 movies");
  });
});

describe("MAX_SEARCH_MOVIES", () => {
  it("is a positive whole number", () => {
    expect(Number.isInteger(MAX_SEARCH_MOVIES)).toBe(true);
    expect(MAX_SEARCH_MOVIES).toBeGreaterThan(0);
  });
});

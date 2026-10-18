import { describe, expect, it } from "vitest";
import { MAX_REFRESH_MOVIES, refreshStartedMessage } from "./movie-refresh";

describe("refreshStartedMessage", () => {
  it("uses the singular for one movie", () => {
    expect(refreshStartedMessage(1)).toBe("Started a refresh and scan for 1 movie. Reload in a minute to see changes.");
  });

  it("uses the plural otherwise", () => {
    expect(refreshStartedMessage(3)).toBe("Started a refresh and scan for 3 movies. Reload in a minute to see changes.");
  });
});

describe("MAX_REFRESH_MOVIES", () => {
  it("is a positive whole number", () => {
    expect(Number.isInteger(MAX_REFRESH_MOVIES)).toBe(true);
    expect(MAX_REFRESH_MOVIES).toBeGreaterThan(0);
  });
});

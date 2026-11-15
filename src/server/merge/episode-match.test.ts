import "server-only";
import { describe, expect, it } from "vitest";
import { sameEpisode } from "./episode-match";

describe("sameEpisode", () => {
  it.each([
    [100, 100, true],
    [100, 200, false],
    [null, 200, true],
    [100, null, true],
    [null, null, true],
  ])("Sonarr %s and TMDB %s gives %s", (sonarr, tmdb, expected) => {
    expect(sameEpisode(sonarr, tmdb)).toBe(expected);
  });
});

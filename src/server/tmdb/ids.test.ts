import "server-only";
import { describe, expect, it } from "vitest";
import { tmdbIdParam } from "./ids";

// The id gate for the Popular preview pages and the person page: a bad id is the not-found page, never a TMDB call.
describe("tmdbIdParam", () => {
  it.each([["1", 1], ["550", 550], ["100000000", 100_000_000]])("accepts %s", (raw, id) => {
    expect(tmdbIdParam.safeParse(raw)).toEqual({ success: true, data: id });
  });

  it.each(["0", "-1", "abc", "12a", "1.5", "100000001", "1234567890", "", "ddd"])("refuses %j", (raw) => {
    expect(tmdbIdParam.safeParse(raw).success).toBe(false);
  });
});

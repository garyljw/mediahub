import { describe, expect, it } from "vitest";
import { parsePopularParams } from "./popular-params";

describe("parsePopularParams", () => {
  it("reads a service id and the TV mode", () => {
    expect(parsePopularParams({ service: "337", kind: "tv" })).toEqual({ service: 337, mode: "tv" });
  });

  it.each([
    ["a non-number", { service: "abc", kind: "x" }],
    ["a negative or zero id", { service: "-1" }],
    ["a decimal", { service: "8.5" }],
    ["a repeated parameter", { service: ["8", "9"], kind: ["tv", "movie"] }],
    ["an over-long number", { service: "12345678901234" }],
    ["nothing", {}],
  ])("falls back to the defaults for %s", (_name, raw) => {
    expect(parsePopularParams(raw)).toEqual({ service: null, mode: "movie" });
  });
});

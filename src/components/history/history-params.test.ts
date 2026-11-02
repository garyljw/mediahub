import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_PARAMS,
  historyHref,
  parseHistoryParams,
  setHistoryType,
  toggleHistoryEvent,
} from "./history-params";

describe("parseHistoryParams", () => {
  it("gives the defaults for no params", () => {
    expect(parseHistoryParams({})).toEqual(DEFAULT_HISTORY_PARAMS);
  });

  it("accepts the three types and falls back to all for anything else", () => {
    expect(parseHistoryParams({ type: "movies" }).type).toBe("movies");
    expect(parseHistoryParams({ type: "tv" }).type).toBe("tv");
    expect(parseHistoryParams({ type: "radarr" }).type).toBe("all");
    expect(parseHistoryParams({ type: "" }).type).toBe("all");
  });

  it("drops unknown event names, removes duplicates and keeps canonical order", () => {
    expect(parseHistoryParams({ events: "failed,bogus,grabbed,failed" }).events).toEqual(["grabbed", "failed"]);
  });

  it("reads events from a repeated key as well as a comma list", () => {
    expect(parseHistoryParams({ events: ["ignored", "imported,deleted"] }).events).toEqual([
      "imported",
      "deleted",
      "ignored",
    ]);
  });

  it("accepts the five limits and gives the default for anything else", () => {
    for (const limit of [100, 200, 300, 400, 500]) {
      expect(parseHistoryParams({ limit: String(limit) }).limit).toBe(limit);
    }
    for (const bad of ["150", "600", "0", "-100", "abc", "", "200.5", "1e2x"]) {
      expect(parseHistoryParams({ limit: bad }).limit).toBe(100);
    }
  });

  it("uses the first value when a key is repeated", () => {
    expect(parseHistoryParams({ type: ["tv", "movies"], limit: ["300", "200"] })).toEqual({
      type: "tv",
      events: [],
      limit: 300,
    });
  });
});

describe("historyHref", () => {
  it("is plain /history for the defaults", () => {
    expect(historyHref(DEFAULT_HISTORY_PARAMS)).toBe("/history");
  });

  it("writes only the values that differ from the defaults", () => {
    expect(historyHref({ type: "movies", events: ["grabbed", "failed"], limit: 200 })).toBe(
      "/history?type=movies&events=grabbed,failed&limit=200",
    );
    expect(historyHref({ type: "all", events: [], limit: 500 })).toBe("/history?limit=500");
  });

  it("round-trips through parseHistoryParams", () => {
    const params = { type: "tv" as const, events: ["imported" as const, "renamed" as const], limit: 400 };
    expect(parseHistoryParams(Object.fromEntries(new URL(historyHref(params), "http://x").searchParams))).toEqual(
      params,
    );
  });
});

describe("filter changes", () => {
  it("resets the limit when the type changes", () => {
    expect(setHistoryType({ ...DEFAULT_HISTORY_PARAMS, limit: 400 }, "tv")).toEqual({
      type: "tv",
      events: [],
      limit: 100,
    });
  });

  it("adds and removes an event in canonical order and resets the limit", () => {
    const start = { type: "all" as const, events: ["failed" as const], limit: 300 };
    expect(toggleHistoryEvent(start, "grabbed")).toEqual({ type: "all", events: ["grabbed", "failed"], limit: 100 });
    expect(toggleHistoryEvent(start, "failed")).toEqual({ type: "all", events: [], limit: 100 });
  });
});

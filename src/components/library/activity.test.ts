import { describe, expect, it } from "vitest";
import type { ActivityState, QueueActivity } from "@/server/arr/activity";
import { ACTIVITY_POLL_MS, ACTIVITY_TIMEOUT_MS, activityById, activityLabel, showsProgress } from "./activity";

function activity(overrides: Partial<QueueActivity> = {}): QueueActivity {
  return { id: 1, state: "downloading", severity: "ok", progress: null, etaSeconds: null, messages: [], count: 1, ...overrides };
}

describe("poll constants", () => {
  it("poll every ten seconds and time out after twenty", () => {
    expect(ACTIVITY_POLL_MS).toBe(10_000);
    expect(ACTIVITY_TIMEOUT_MS).toBe(20_000);
  });
});

describe("activityLabel", () => {
  const base: Array<[ActivityState, string]> = [
    ["queued", "Queued"],
    ["downloading", "Downloading"],
    ["paused", "Paused"],
    ["delayed", "Delayed"],
    ["importPending", "Waiting to import"],
    ["importing", "Importing"],
    ["importBlocked", "Import blocked"],
    ["failed", "Download failed"],
    ["clientUnavailable", "Download client unavailable"],
    ["unknown", "In queue"],
  ];

  it.each(base)("labels %s as %j", (state, expected) => {
    expect(activityLabel(activity({ state }))).toBe(expected);
  });

  it("adds the progress percent to a downloading or paused item", () => {
    expect(activityLabel(activity({ state: "downloading", progress: 75 }))).toBe("Downloading 75%");
    expect(activityLabel(activity({ state: "paused", progress: 10 }))).toBe("Paused 10%");
  });

  it("does not add progress to other states, or when progress is unknown", () => {
    expect(activityLabel(activity({ state: "queued", progress: 50 }))).toBe("Queued");
    expect(activityLabel(activity({ state: "downloading", progress: null }))).toBe("Downloading");
    expect(activityLabel(activity({ state: "paused", progress: null }))).toBe("Paused");
  });

  it("adds the eta to a downloading item, after the progress", () => {
    expect(activityLabel(activity({ state: "downloading", progress: 75, etaSeconds: 3900 }))).toBe(
      "Downloading 75% · 1h 5m",
    );
    expect(activityLabel(activity({ state: "downloading", progress: null, etaSeconds: 720 }))).toBe(
      "Downloading · 12m",
    );
  });

  it("does not add an eta to a paused item or one without an estimate", () => {
    expect(activityLabel(activity({ state: "paused", progress: 40, etaSeconds: 720 }))).toBe("Paused 40%");
    expect(activityLabel(activity({ state: "downloading", progress: 40, etaSeconds: null }))).toBe("Downloading 40%");
  });

  it("appends the count of other items when there is more than one", () => {
    expect(activityLabel(activity({ state: "importBlocked", count: 2 }))).toBe("Import blocked (+1 more)");
    expect(activityLabel(activity({ state: "downloading", progress: 5, count: 4 }))).toBe("Downloading 5% (+3 more)");
  });
});

describe("showsProgress", () => {
  it.each([
    ["downloading", 0],
    ["downloading", 75],
    ["paused", 10],
  ] as const)("is true for %s at %i%%", (state, progress) => {
    expect(showsProgress(activity({ state, progress }))).toBe(true);
  });

  it.each([
    ["downloading with no progress", activity({ state: "downloading", progress: null })],
    ["paused with no progress", activity({ state: "paused", progress: null })],
    ["queued with progress", activity({ state: "queued", progress: 50 })],
    ["importBlocked with progress", activity({ state: "importBlocked", progress: 100 })],
    ["failed with progress", activity({ state: "failed", progress: 0 })],
  ])("is false for %s", (_label, entry) => {
    expect(showsProgress(entry)).toBe(false);
  });
});

describe("activityById", () => {
  it("indexes the items by id", () => {
    const map = activityById([activity({ id: 3 }), activity({ id: 9, state: "paused" })]);
    expect(map.size).toBe(2);
    expect(map.get(3)?.state).toBe("downloading");
    expect(map.get(9)?.state).toBe("paused");
    expect(map.get(4)).toBeUndefined();
  });

  it("returns an empty map for no items", () => {
    expect(activityById([]).size).toBe(0);
  });
});

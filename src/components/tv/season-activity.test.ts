import { describe, expect, it } from "vitest";
import type { QueueActivity } from "@/server/arr/activity";
import { seasonActivitySummary } from "./season-activity";

function activity(id: number, overrides: Partial<QueueActivity> = {}): QueueActivity {
  return {
    id,
    state: "downloading",
    severity: "ok",
    progress: 10,
    etaSeconds: null,
    messages: [],
    count: 1,
    ...overrides,
  };
}

describe("seasonActivitySummary", () => {
  it("returns null when no episode of the season is in the queue", () => {
    const byId = new Map([[500, activity(500)]]);
    expect(seasonActivitySummary(byId, [1, 2, 3])).toBeNull();
  });

  it("returns null for an empty season", () => {
    expect(seasonActivitySummary(new Map([[1, activity(1)]]), [])).toBeNull();
  });

  it("counts only the season's episodes that are in the queue", () => {
    const byId = new Map([
      [1, activity(1)],
      [3, activity(3)],
      [500, activity(500)],
    ]);
    expect(seasonActivitySummary(byId, [1, 2, 3])).toEqual({ count: 2, severity: "ok", state: "downloading" });
  });

  it("takes the severity from the worst episode, whatever its position", () => {
    const byId = new Map([
      [1, activity(1, { severity: "ok" })],
      [2, activity(2, { severity: "error", state: "failed" })],
      [3, activity(3, { severity: "warning", state: "importBlocked" })],
    ]);
    expect(seasonActivitySummary(byId, [1, 2, 3])).toEqual({ count: 3, severity: "error", state: "failed" });
  });

  it("takes the state of the first episode in season order when two tie on severity", () => {
    const byId = new Map([
      [1, activity(1, { severity: "warning", state: "importBlocked" })],
      [2, activity(2, { severity: "warning", state: "clientUnavailable" })],
    ]);
    expect(seasonActivitySummary(byId, [1, 2])).toEqual({ count: 2, severity: "warning", state: "importBlocked" });
    expect(seasonActivitySummary(byId, [2, 1])).toEqual({ count: 2, severity: "warning", state: "clientUnavailable" });
  });
});

import { describe, expect, it } from "vitest";
import {
  compareQueueRows,
  keepLastKnown,
  NEVER_LOADED,
  visibleQueue,
  type LastKnownRows,
  type QueueRow,
} from "./queue-rows";

function row(overrides: Partial<QueueRow> & Pick<QueueRow, "key">): QueueRow {
  return {
    app: "radarr",
    queueId: 1,
    queueIds: [1],
    kind: "movie",
    title: "Title",
    detail: "",
    href: null,
    posterSrc: null,
    state: "downloading",
    severity: "ok",
    progress: 10,
    etaSeconds: null,
    messages: [],
    details: null,
    ...overrides,
  };
}

const RADARR_A = row({ key: "radarr-1", app: "radarr", title: "Alpha", etaSeconds: 600 });
const RADARR_B = row({ key: "radarr-2", app: "radarr", title: "Bravo", etaSeconds: null });
const SONARR_A = row({ key: "sonarr-9", app: "sonarr", title: "Aardvark Show", etaSeconds: 300 });
const SONARR_ERR = row({ key: "sonarr-10", app: "sonarr", title: "Zulu Show", severity: "error" });

describe("compareQueueRows", () => {
  it("puts errors first, then warnings, then the rest", () => {
    const warning = row({ key: "w", severity: "warning" });
    const ok = row({ key: "o", severity: "ok" });
    expect([ok, warning, SONARR_ERR].sort(compareQueueRows).map((r) => r.severity)).toEqual(["error", "warning", "ok"]);
  });

  it("sorts by ETA ascending with unknown last, then title, then key", () => {
    const early = row({ key: "e", title: "Zed", etaSeconds: 60 });
    const late = row({ key: "l", title: "Able", etaSeconds: 600 });
    const unknownA = row({ key: "u1", title: "Able", etaSeconds: null });
    const unknownB = row({ key: "u2", title: "Able", etaSeconds: null });
    expect([unknownB, late, unknownA, early].sort(compareQueueRows).map((r) => r.key)).toEqual(["e", "l", "u1", "u2"]);
  });
});

describe("keepLastKnown", () => {
  it("replaces each app's rows from a successful fetch", () => {
    const known = keepLastKnown(NEVER_LOADED, [RADARR_A, SONARR_A], { radarr: false, sonarr: false });
    expect(known.radarr).toEqual([RADARR_A]);
    expect(known.sonarr).toEqual([SONARR_A]);
  });

  it("keeps the earlier rows of a failed app", () => {
    const before = keepLastKnown(NEVER_LOADED, [RADARR_A, SONARR_A], { radarr: false, sonarr: false });
    const after = keepLastKnown(before, [], { radarr: true, sonarr: false });
    expect(after.radarr).toEqual([RADARR_A]);
    expect(after.sonarr).toEqual([]);
  });

  it("keeps null for a failed app that never loaded", () => {
    const known = keepLastKnown(NEVER_LOADED, [SONARR_A], { radarr: true, sonarr: false });
    expect(known.radarr).toBeNull();
  });
});

describe("visibleQueue", () => {
  it("shows the rows of both apps in the queue order", () => {
    const known: LastKnownRows = { radarr: [RADARR_A, RADARR_B], sonarr: [SONARR_A, SONARR_ERR] };
    const view = visibleQueue(known, { radarr: false, sonarr: false });
    expect(view.rows.map((r) => r.key)).toEqual(["sonarr-10", "sonarr-9", "radarr-1", "radarr-2"]);
    expect(view.alerts).toEqual([]);
  });

  it("sorts a kept row together with fresh rows, not in front of them", () => {
    // Radarr failed this time, so its kept rows sit in the same order as the fresh Sonarr rows.
    const known: LastKnownRows = { radarr: [RADARR_A], sonarr: [SONARR_ERR] };
    const view = visibleQueue(known, { radarr: true, sonarr: false });
    expect(view.rows.map((r) => r.key)).toEqual(["sonarr-10", "radarr-1"]);
  });

  it("keeps a failed app's last rows and says they are the last known state", () => {
    const known: LastKnownRows = { radarr: [RADARR_A], sonarr: [SONARR_A] };
    const view = visibleQueue(known, { radarr: true, sonarr: false });
    expect(view.rows.map((r) => r.key)).toContain("radarr-1");
    expect(view.alerts).toEqual(["Couldn't refresh the queue from Radarr; showing the last known state."]);
  });

  it("shows a load error for a side that never loaded", () => {
    const view = visibleQueue({ radarr: null, sonarr: [SONARR_A] }, { radarr: true, sonarr: false });
    expect(view.rows.map((r) => r.key)).toEqual(["sonarr-9"]);
    expect(view.alerts).toEqual(["Couldn't load the queue from Radarr."]);
  });

  it("uses one message when both sides fail and neither ever loaded", () => {
    const view = visibleQueue(NEVER_LOADED, { radarr: true, sonarr: true });
    expect(view.rows).toEqual([]);
    expect(view.alerts).toEqual(["Couldn't load the queue from Radarr or Sonarr."]);
  });

  it("shows the refresh message for each side with earlier rows when both fail", () => {
    const view = visibleQueue({ radarr: [RADARR_A], sonarr: [] }, { radarr: true, sonarr: true });
    expect(view.alerts).toEqual([
      "Couldn't refresh the queue from Radarr; showing the last known state.",
      "Couldn't refresh the queue from Sonarr; showing the last known state.",
    ]);
  });

  it("gives no alert for a successful side with no rows", () => {
    const view = visibleQueue({ radarr: [], sonarr: [] }, { radarr: false, sonarr: false });
    expect(view.rows).toEqual([]);
    expect(view.alerts).toEqual([]);
  });
});

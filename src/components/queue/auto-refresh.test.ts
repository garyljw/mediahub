import { describe, expect, it, vi } from "vitest";
import { createAutoRefresh, QUEUE_REFRESH_MS, REFRESH_WATCHDOG_MS } from "./auto-refresh";

/** A clock that only moves when the test calls advance(). Timers run in order of their due time. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    setTimer(run: () => void, ms: number): unknown {
      const id = nextId++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer(handle: unknown) {
      timers.delete(handle as number);
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        let due: [number, { at: number; run: () => void }] | undefined;
        for (const entry of timers) {
          if (entry[1].at <= end && (due === undefined || entry[1].at < due[1].at)) due = entry;
        }
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
    pendingCount: () => timers.size,
  };
}

/** Watchdog is pushed far away unless a test is about the watchdog, so it can't end a refresh by accident. */
const FAR = 10_000_000;

function setup({ hidden = false, watchdogMs = FAR }: { hidden?: boolean; watchdogMs?: number } = {}) {
  const clock = fakeClock();
  let isHidden = hidden;
  const refresh = vi.fn();
  const refresher = createAutoRefresh({
    refresh,
    isHidden: () => isHidden,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    intervalMs: QUEUE_REFRESH_MS,
    watchdogMs,
  });
  return {
    refresher,
    refresh,
    clock,
    show: () => (isHidden = false),
    hide: () => (isHidden = true),
  };
}

describe("createAutoRefresh timing", () => {
  it("requests a refresh every ten seconds while visible, not before the first interval", () => {
    expect(QUEUE_REFRESH_MS).toBe(10_000);
    const { refresher, refresh, clock } = setup();
    refresher.start();

    clock.advance(9_999);
    expect(refresh).not.toHaveBeenCalled();
    clock.advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("starts the next interval ten seconds after the refresh reports done, not after it was requested", () => {
    const { refresher, refresh, clock } = setup();
    refresher.start();
    clock.advance(10_000); // refresh 1 requested at t=10s
    clock.advance(25_000); // t=35s, still running
    expect(refresh).toHaveBeenCalledTimes(1);

    refresher.onRefreshDone(); // finished at t=35s
    clock.advance(9_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    clock.advance(1); // t=45s
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("ignores onRefreshDone when no refresh is running", () => {
    const { refresher, refresh, clock } = setup();
    refresher.start();
    refresher.onRefreshDone();
    clock.advance(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    // Only the watchdog of the refresh still pending is left.
    expect(clock.pendingCount()).toBe(1);
  });
});

describe("createAutoRefresh no overlap", () => {
  it("never requests a second refresh while one is pending", () => {
    const { refresher, refresh, clock } = setup();
    refresher.start();
    clock.advance(10_000);
    clock.advance(600_000); // ten minutes with no done signal (the far watchdog is still pending)
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(1);
  });

  it("does not start a refresh on becoming visible while one is pending", () => {
    const { refresher, refresh, clock, hide, show } = setup();
    refresher.start();
    clock.advance(10_000); // refresh 1 pending
    hide();
    refresher.onVisibilityChange();
    show();
    refresher.onVisibilityChange();
    expect(refresh).toHaveBeenCalledTimes(1);

    refresher.onRefreshDone(); // t=10s
    clock.advance(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("createAutoRefresh hidden tab", () => {
  it("schedules nothing when it starts hidden, and refreshes once when it becomes visible", () => {
    const { refresher, refresh, clock, show } = setup({ hidden: true });
    refresher.start();
    expect(clock.pendingCount()).toBe(0);
    clock.advance(60_000);
    expect(refresh).not.toHaveBeenCalled();

    show();
    refresher.onVisibilityChange();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops scheduling when hidden and leaves no timer behind", () => {
    const { refresher, refresh, clock, hide } = setup();
    refresher.start();
    hide();
    refresher.onVisibilityChange();
    clock.advance(60_000);

    expect(refresh).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it("refreshes on becoming visible only when idle, and carries on at the normal interval", () => {
    const { refresher, refresh, clock, hide, show } = setup();
    refresher.start();
    clock.advance(10_000);
    refresher.onRefreshDone();

    hide();
    refresher.onVisibilityChange();
    clock.advance(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    show();
    refresher.onVisibilityChange();
    expect(refresh).toHaveBeenCalledTimes(2);

    // A visibility event that changes nothing does not refresh again.
    refresher.onVisibilityChange();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("createAutoRefresh watchdog and lifecycle", () => {
  it("resumes after the watchdog if a refresh never reports done", () => {
    const { refresher, refresh, clock } = setup({ watchdogMs: REFRESH_WATCHDOG_MS });
    refresher.start();
    clock.advance(10_000); // refresh 1 at t=10s, watchdog at t=40s
    clock.advance(REFRESH_WATCHDOG_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(1);

    clock.advance(1); // t=40s: watchdog ends it, next at t=50s
    clock.advance(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does nothing after stop(), even when the tab becomes visible or a refresh finishes", () => {
    const { refresher, refresh, clock, hide, show } = setup();
    refresher.start();
    clock.advance(10_000);
    refresher.stop();
    hide();
    show();
    refresher.onVisibilityChange();
    refresher.onRefreshDone();
    clock.advance(60_000);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(0);
  });

  it("does not stack timers when start() runs twice", () => {
    const { refresher, refresh, clock } = setup();
    refresher.start();
    refresher.start();
    clock.advance(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

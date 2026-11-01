// The polling loop behind the Activity column, kept out of React so it can be tested in plain node.
// Must not import from src/server at runtime (type imports only).
import type { QueueActivity } from "@/server/arr/activity";

export type ActivityReport = { items: QueueActivity[]; failed: boolean };

export type ActivityPollerOptions = {
  /** One request to the activity route. The signal aborts it on timeout or stop. */
  fetchActivity: (signal: AbortSignal) => Promise<Response>;
  /** True while the tab is hidden. Nothing is fetched then. */
  isHidden: () => boolean;
  /** Timers are injected so tests control time. The handle type is whatever setTimer returns. */
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Called only when the items or the failed flag actually change. */
  onChange: (report: ActivityReport) => void;
  pollMs: number;
  /** Per request. A request still pending after this is aborted and counts as a failure. */
  timeoutMs: number;
};

export type ActivityPoller = {
  /** Fetches at once if the tab is visible, then keeps polling. Does nothing after stop(). */
  start: () => void;
  /** Aborts any request in flight, clears the timer and never calls onChange again. */
  stop: () => void;
  /** Call when the tab's visibility changes. Fetches at once when it becomes visible and idle. */
  onVisibilityChange: () => void;
};

type InFlight = { controller: AbortController; timedOut: boolean; timeout: unknown };

/** A light shape check. The server builds the items, so only the outer shape is checked here. */
function isActivityBody(body: unknown): body is { items: QueueActivity[] } {
  return typeof body === "object" && body !== null && Array.isArray((body as { items?: unknown }).items);
}

/**
 * Polls one request at a time. The next poll is pollMs after the previous request finishes, so requests
 * never overlap, and nothing is scheduled while the tab is hidden.
 */
export function createActivityPoller(options: ActivityPollerOptions): ActivityPoller {
  const { fetchActivity, isHidden, setTimer, clearTimer, onChange, pollMs, timeoutMs } = options;

  // The last good items, as both the array and its JSON, so an identical reply is cheap to recognise.
  let items: QueueActivity[] = [];
  let itemsJson = "[]";
  let failed = false;
  // What onChange last reported. Only a difference from this is worth a re-render.
  let reported = { itemsJson: "[]", failed: false };

  let started = false;
  let stopped = false;
  let pollTimer: unknown;
  let inFlight: InFlight | null = null;

  function publish() {
    if (stopped) return;
    if (reported.itemsJson === itemsJson && reported.failed === failed) return;
    reported = { itemsJson, failed };
    onChange({ items, failed });
  }

  function succeed(next: QueueActivity[]) {
    const json = JSON.stringify(next);
    if (json !== itemsJson) {
      items = next;
      itemsJson = json;
    }
    failed = false;
    publish();
  }

  // Keeps the last good items, and only flags that they may be stale.
  function fail() {
    failed = true;
    publish();
  }

  function clearPollTimer() {
    if (pollTimer !== undefined) {
      clearTimer(pollTimer);
      pollTimer = undefined;
    }
  }

  function schedule() {
    clearPollTimer();
    if (stopped || isHidden()) return;
    pollTimer = setTimer(() => {
      pollTimer = undefined;
      void poll();
    }, pollMs);
  }

  async function poll(): Promise<void> {
    if (stopped || inFlight !== null || isHidden()) return;
    clearPollTimer();

    const controller = new AbortController();
    const attempt: InFlight = { controller, timedOut: false, timeout: undefined };
    inFlight = attempt;
    attempt.timeout = setTimer(() => {
      attempt.timedOut = true;
      controller.abort();
    }, timeoutMs);

    let keepPolling = true;
    try {
      const res = await fetchActivity(controller.signal);
      if (res.status === 401 || res.status === 403) {
        // The session ended or the role changed. Say so (the stale data gets flagged), then stop for good.
        keepPolling = false;
        fail();
      } else {
        const body: unknown = res.ok ? await res.json() : undefined;
        if (!isActivityBody(body)) throw new Error("activity reply was not usable");
        succeed(body.items);
      }
    } catch {
      // A timeout is an ordinary failure. An abort from stop() is silent. Any other error is a failure too.
      if (attempt.timedOut || !controller.signal.aborted) fail();
      else keepPolling = false;
    } finally {
      clearTimer(attempt.timeout);
      inFlight = null;
    }

    if (!keepPolling) {
      stopped = true;
      return;
    }
    schedule();
  }

  return {
    start() {
      if (started) return;
      started = true;
      void poll();
    },
    stop() {
      stopped = true;
      clearPollTimer();
      inFlight?.controller.abort();
    },
    onVisibilityChange() {
      if (stopped || inFlight !== null || isHidden()) return;
      void poll();
    },
  };
}

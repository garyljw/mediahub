import { describe, expect, it, vi } from "vitest";
import type { QueueActivity } from "@/server/arr/activity";
import { type ActivityPollerOptions, createActivityPoller } from "./activity-poller";

const POLL_MS = 10_000;
const TIMEOUT_MS = 20_000;

const ITEM: QueueActivity = {
  id: 1,
  state: "downloading",
  severity: "ok",
  progress: 10,
  etaSeconds: null,
  messages: [],
  count: 1,
};
const OTHER: QueueActivity = { ...ITEM, id: 2, state: "paused", progress: null };

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

/** Lets promise callbacks and response-body reads finish. Real timers, so no fake clock involved. */
async function flush() {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
}

type Pending = { signal: AbortSignal; resolve: (res: Response) => void; reject: (error: unknown) => void };

function setup(overrides: Partial<ActivityPollerOptions> = {}) {
  const clock = fakeClock();
  let hidden = false;
  const pending: Pending[] = [];
  const fetchActivity = vi.fn(
    (signal: AbortSignal) =>
      new Promise<Response>((resolve, reject) => {
        pending.push({ signal, resolve, reject });
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const onChange = vi.fn();
  const poller = createActivityPoller({
    fetchActivity,
    isHidden: () => hidden,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onChange,
    pollMs: POLL_MS,
    timeoutMs: TIMEOUT_MS,
    ...overrides,
  });
  return {
    poller,
    clock,
    fetchActivity,
    onChange,
    pending,
    setHidden(value: boolean) {
      hidden = value;
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Answers the request at `index` (in call order) and lets the poller process the reply. */
async function answer(s: ReturnType<typeof setup>, index: number, res: Response) {
  s.pending[index].resolve(res);
  await flush();
}

describe("createActivityPoller", () => {
  it("fetches once on start, with a signal", () => {
    const s = setup();
    s.poller.start();
    expect(s.fetchActivity).toHaveBeenCalledTimes(1);
    expect(s.fetchActivity.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("polls pollMs after the previous request finishes, never overlapping", async () => {
    const s = setup();
    s.poller.start();

    s.clock.advance(5_000);
    expect(s.fetchActivity).toHaveBeenCalledTimes(1);
    await answer(s, 0, json({ items: [ITEM] }));

    // The next poll is due POLL_MS after the reply at t=5000, not after the start at t=0.
    s.clock.advance(POLL_MS - 1);
    expect(s.fetchActivity).toHaveBeenCalledTimes(1);
    s.clock.advance(1);
    expect(s.fetchActivity).toHaveBeenCalledTimes(2);
  });

  it("does not start a second request while one is still in flight", () => {
    const s = setup();
    s.poller.start();
    s.clock.advance(15_000);
    expect(s.fetchActivity).toHaveBeenCalledTimes(1);
  });

  it("does not poll while hidden, and fetches at once when the tab becomes visible", () => {
    const s = setup();
    s.setHidden(true);
    s.poller.start();
    expect(s.fetchActivity).not.toHaveBeenCalled();

    s.clock.advance(60_000);
    expect(s.fetchActivity).not.toHaveBeenCalled();

    s.setHidden(false);
    s.poller.onVisibilityChange();
    expect(s.fetchActivity).toHaveBeenCalledTimes(1);
  });

  it("pauses a scheduled poll when the tab hides, and resumes on visible", async () => {
    const s = setup();
    s.poller.start();
    await answer(s, 0, json({ items: [] }));

    s.setHidden(true);
    s.clock.advance(POLL_MS * 3);
    expect(s.fetchActivity).toHaveBeenCalledTimes(1);

    s.setHidden(false);
    s.poller.onVisibilityChange();
    expect(s.fetchActivity).toHaveBeenCalledTimes(2);
  });

  it("does not start a second request when the tab becomes visible during a request", async () => {
    const s = setup();
    s.poller.start();
    s.poller.onVisibilityChange();
    expect(s.fetchActivity).toHaveBeenCalledTimes(1);
    await answer(s, 0, json({ items: [] }));
    expect(s.fetchActivity).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous items on a 502, reports failed, and keeps polling", async () => {
    const s = setup();
    s.poller.start();
    await answer(s, 0, json({ items: [ITEM] }));
    expect(s.onChange).toHaveBeenLastCalledWith({ items: [ITEM], failed: false });

    s.clock.advance(POLL_MS);
    await answer(s, 1, json({ error: "activity unavailable" }, 502));
    expect(s.onChange).toHaveBeenLastCalledWith({ items: [ITEM], failed: true });

    s.clock.advance(POLL_MS);
    expect(s.fetchActivity).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["an HTML page", () => new Response("<html>login</html>", { status: 200 })],
    ["a body with no items list", () => json({ records: [] })],
    ["items that is not a list", () => json({ items: "nope" })],
    ["a JSON null", () => json(null)],
  ])("counts %s as a failure", async (_label, makeResponse) => {
    const s = setup();
    s.poller.start();
    await answer(s, 0, makeResponse());
    expect(s.onChange).toHaveBeenLastCalledWith({ items: [], failed: true });
  });

  it("aborts a request that times out, reports failed, and keeps polling", async () => {
    const s = setup();
    s.poller.start();
    s.clock.advance(TIMEOUT_MS);
    await flush();

    expect(s.pending[0].signal.aborted).toBe(true);
    expect(s.onChange).toHaveBeenLastCalledWith({ items: [], failed: true });

    s.clock.advance(POLL_MS);
    expect(s.fetchActivity).toHaveBeenCalledTimes(2);
  });

  it("does not time out a request that answered in time", async () => {
    const s = setup();
    s.poller.start();
    await answer(s, 0, json({ items: [] }));
    s.clock.advance(TIMEOUT_MS * 2);
    expect(s.pending[0].signal.aborted).toBe(false);
    expect(s.onChange).not.toHaveBeenCalledWith(expect.objectContaining({ failed: true }));
  });

  it.each([401, 403])("reports failed and stops for good on a %i", async (status) => {
    const s = setup();
    s.poller.start();
    await answer(s, 0, json({ error: "unauthorized" }, status));
    expect(s.onChange).toHaveBeenLastCalledWith({ items: [], failed: true });

    s.clock.advance(POLL_MS * 10);
    s.poller.onVisibilityChange();
    expect(s.fetchActivity).toHaveBeenCalledTimes(1);
  });

  it("stop() aborts the request in flight, calls nothing afterwards, and never fetches again", async () => {
    const s = setup();
    s.poller.start();
    s.poller.stop();
    expect(s.pending[0].signal.aborted).toBe(true);
    await flush();

    expect(s.onChange).not.toHaveBeenCalled();
    s.clock.advance(POLL_MS * 10);
    s.poller.onVisibilityChange();
    expect(s.fetchActivity).toHaveBeenCalledTimes(1);
    expect(s.clock.pendingCount()).toBe(0);
  });

  it("stop() also clears a scheduled poll", async () => {
    const s = setup();
    s.poller.start();
    await answer(s, 0, json({ items: [] }));
    s.poller.stop();
    s.clock.advance(POLL_MS * 10);
    expect(s.fetchActivity).toHaveBeenCalledTimes(1);
  });

  it("does not call onChange for an identical reply", async () => {
    const s = setup();
    s.poller.start();
    await answer(s, 0, json({ items: [ITEM] }));
    s.clock.advance(POLL_MS);
    await answer(s, 1, json({ items: [ITEM] }));
    expect(s.onChange).toHaveBeenCalledTimes(1);
  });

  it("calls onChange when the items change", async () => {
    const s = setup();
    s.poller.start();
    await answer(s, 0, json({ items: [ITEM] }));
    s.clock.advance(POLL_MS);
    await answer(s, 1, json({ items: [ITEM, OTHER] }));
    expect(s.onChange).toHaveBeenLastCalledWith({ items: [ITEM, OTHER], failed: false });
    expect(s.onChange).toHaveBeenCalledTimes(2);
  });

  it("clears failed on the first success after a failure, and reports it", async () => {
    const s = setup();
    s.poller.start();
    await answer(s, 0, json({ items: [ITEM] }));
    s.clock.advance(POLL_MS);
    await answer(s, 1, json({ error: "x" }, 502));
    s.clock.advance(POLL_MS);
    await answer(s, 2, json({ items: [ITEM] }));
    expect(s.onChange).toHaveBeenLastCalledWith({ items: [ITEM], failed: false });
    expect(s.onChange).toHaveBeenCalledTimes(3);
  });

  it("does not report failed again while it stays failed", async () => {
    const s = setup();
    s.poller.start();
    await answer(s, 0, json({ error: "x" }, 502));
    s.clock.advance(POLL_MS);
    await answer(s, 1, json({ error: "x" }, 502));
    expect(s.onChange).toHaveBeenCalledTimes(1);
  });
});

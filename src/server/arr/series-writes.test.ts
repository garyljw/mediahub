import "server-only";
import { describe, expect, it, vi } from "vitest";

import { queueSeriesWrite } from "./series-writes";

describe("queueSeriesWrite", () => {
  it("runs writes to one series one at a time, in order", async () => {
    const order: string[] = [];
    let releaseFirst = () => {};
    const first = queueSeriesWrite(1, async () => {
      order.push("first start");
      await new Promise<void>((resolve) => (releaseFirst = resolve));
      order.push("first end");
    });
    const second = queueSeriesWrite(1, async () => {
      order.push("second");
    });
    // The first task starts a few microtasks later, once its place in the queue is reached.
    await vi.waitFor(() => expect(order).toEqual(["first start"]));
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first start", "first end", "second"]);
  });

  it("still runs the next write when the previous one failed, and gives each caller its own result", async () => {
    const failed = queueSeriesWrite(2, async () => {
      throw new Error("boom");
    });
    const next = vi.fn(async () => {});
    const succeeded = queueSeriesWrite(2, next);
    await expect(failed).rejects.toThrow("boom");
    await expect(succeeded).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("doesn't make writes to different series wait for each other", async () => {
    let releaseFirst = () => {};
    const started = vi.fn();
    const blocked = queueSeriesWrite(3, () => {
      started();
      return new Promise<void>((resolve) => (releaseFirst = resolve));
    });
    const other = vi.fn(async () => {});
    await queueSeriesWrite(4, other);
    expect(other).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    releaseFirst();
    await blocked;
  });
});

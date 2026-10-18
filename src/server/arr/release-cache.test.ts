import "server-only";
import { describe, expect, it } from "vitest";
import { createReleaseCache, type CachedRelease } from "./release-cache";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function release(n: number): CachedRelease {
  return { guid: `https://indexer.test/details/${n}`, indexerId: 1, title: `Release ${n}` };
}

/** A cache with a clock the test moves by hand. */
function makeCache(ttlMs = 1000, maxEntries = 3) {
  const clock = { time: 0 };
  const cache = createReleaseCache({ ttlMs, maxEntries, now: () => clock.time });
  return { cache, clock };
}

describe("release cache tokens", () => {
  it("returns distinct UUID tokens", () => {
    const { cache } = makeCache();
    const a = cache.put(release(1));
    const b = cache.put(release(2));
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
  });
});

describe("take", () => {
  it("returns the release once, then refuses the token until it expires", () => {
    const { cache, clock } = makeCache(1000);
    const token = cache.put(release(1));
    expect(cache.take(token)?.release).toEqual(release(1));
    expect(cache.take(token)).toBeUndefined();
    // The used entry stays (marked taken) until it expires, then the next put purges it.
    expect(cache.size()).toBe(1);
    clock.time = 1000;
    cache.put(release(2));
    expect(cache.size()).toBe(1);
  });

  it("returns undefined for a token that was never issued", () => {
    const { cache } = makeCache();
    expect(cache.take("00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });

  it("returns undefined once the entry has expired, and removes it", () => {
    const { cache, clock } = makeCache(1000);
    const token = cache.put(release(1));
    clock.time = 999;
    expect(cache.take(token)?.release).toEqual(release(1));

    const second = cache.put(release(2));
    clock.time = 999 + 1000;
    expect(cache.take(second)).toBeUndefined();
  });
});

describe("restore", () => {
  it("makes a taken release takeable again under the same token", () => {
    const { cache } = makeCache();
    const token = cache.put(release(1));
    const taken = cache.take(token);
    expect(taken).toBeDefined();

    taken?.restore();
    expect(cache.take(token)?.release).toEqual(release(1));
  });

  it("keeps the original expiry, so a restored token never outlives Radarr's cache", () => {
    const { cache, clock } = makeCache(1000);
    const token = cache.put(release(1));
    clock.time = 900;
    cache.take(token)?.restore();
    clock.time = 1000;
    expect(cache.take(token)).toBeUndefined();
  });

  it("keeps a restored release in its place, so eviction still drops the oldest first", () => {
    const { cache } = makeCache(1000, 2);
    const first = cache.put(release(1));
    const second = cache.put(release(2));
    cache.take(first)?.restore();
    cache.put(release(3));
    expect(cache.take(first)).toBeUndefined();
    expect(cache.take(second)?.release).toEqual(release(2));
  });

  it("does not evict another entry when restoring into a full cache", () => {
    const { cache } = makeCache(1000, 2);
    const first = cache.put(release(1));
    const second = cache.put(release(2));
    cache.take(second)?.restore();
    expect(cache.size()).toBe(2);
    expect(cache.take(first)?.release).toEqual(release(1));
  });
});

describe("limits", () => {
  it("evicts the oldest entry when the cap is reached", () => {
    const { cache } = makeCache(1000, 3);
    const first = cache.put(release(1));
    const second = cache.put(release(2));
    const third = cache.put(release(3));
    const fourth = cache.put(release(4));

    expect(cache.size()).toBe(3);
    expect(cache.take(first)).toBeUndefined();
    expect(cache.take(second)?.release).toEqual(release(2));
    expect(cache.take(third)?.release).toEqual(release(3));
    expect(cache.take(fourth)?.release).toEqual(release(4));
  });

  it("purges expired entries when a new one is put", () => {
    const { cache, clock } = makeCache(1000, 10);
    cache.put(release(1));
    cache.put(release(2));
    clock.time = 1000;
    expect(cache.size()).toBe(2);

    cache.put(release(3));
    expect(cache.size()).toBe(1);
  });
});

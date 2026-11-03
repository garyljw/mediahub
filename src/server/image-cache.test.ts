import "server-only";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "./arr/request";
import { ARR_IMAGE_TTL_MS, MAX_CACHE_BYTES, cachedArrImage, cachedImage, pruneImageCache, setImageCacheDirForTests } from "./image-cache";

const connections = vi.hoisted(() => ({
  radarr: { url: "http://radarr.lan:7878", apiKey: "k" } as { url: string; apiKey: string } | null,
}));
vi.mock("./settings/connections", () => ({
  getConnection: (app: string) => (app === "radarr" ? connections.radarr : null),
}));

const TTL = 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const KEY = "radarr|http://radarr.lan:7878|poster|123";

function jpeg(marker: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, marker]);
}

function fileFor(dir: string, key: string): string {
  return path.join(dir, `${createHash("sha256").update(key).digest("hex")}.jpg`);
}

/** Sets a file's mtime to `ageMs` in the past. */
function age(file: string, ageMs: number): void {
  const when = new Date(Date.now() - ageMs);
  utimesSync(file, when, when);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "image-cache-test-"));
  setImageCacheDirForTests(dir);
});

afterEach(() => {
  setImageCacheDirForTests(undefined);
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("cachedImage", () => {
  it("fetches on a miss and writes the file", async () => {
    const fetchFresh = vi.fn(async () => jpeg(1));
    const bytes = await cachedImage(KEY, TTL, fetchFresh);

    expect(fetchFresh).toHaveBeenCalledTimes(1);
    expect(Array.from(bytes)).toEqual(Array.from(jpeg(1)));
    expect(Array.from(readFileSync(fileFor(dir, KEY)))).toEqual(Array.from(jpeg(1)));
  });

  it("serves a fresh hit without calling fetchFresh", async () => {
    await cachedImage(KEY, TTL, async () => jpeg(1));
    const fetchFresh = vi.fn(async () => jpeg(2));

    const bytes = await cachedImage(KEY, TTL, fetchFresh);

    expect(fetchFresh).not.toHaveBeenCalled();
    expect(Array.from(bytes)).toEqual(Array.from(jpeg(1)));
  });

  it("refetches and replaces a stale file", async () => {
    await cachedImage(KEY, TTL, async () => jpeg(1));
    age(fileFor(dir, KEY), 2 * TTL);
    const fetchFresh = vi.fn(async () => jpeg(2));

    const bytes = await cachedImage(KEY, TTL, fetchFresh);

    expect(fetchFresh).toHaveBeenCalledTimes(1);
    expect(Array.from(bytes)).toEqual(Array.from(jpeg(2)));
    expect(Array.from(readFileSync(fileFor(dir, KEY)))).toEqual(Array.from(jpeg(2)));
  });

  it("returns the stale copy when the upstream fails with a non-404 ArrRequestError", async () => {
    await cachedImage(KEY, TTL, async () => jpeg(1));
    age(fileFor(dir, KEY), 2 * TTL);

    const bytes = await cachedImage(KEY, TTL, async () => {
      throw new ArrRequestError("Radarr poster request failed: HTTP 502", "http", 502);
    });

    expect(Array.from(bytes)).toEqual(Array.from(jpeg(1)));
  });

  it("rethrows other errors even when a stale copy exists", async () => {
    await cachedImage(KEY, TTL, async () => jpeg(1));
    age(fileFor(dir, KEY), 2 * TTL);

    await expect(
      cachedImage(KEY, TTL, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("deletes the cached file on a 404 and rethrows", async () => {
    await cachedImage(KEY, TTL, async () => jpeg(1));
    age(fileFor(dir, KEY), 2 * TTL);

    const error = await cachedImage(KEY, TTL, async () => {
      throw new ArrRequestError("Radarr poster request failed: HTTP 404", "http", 404);
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).status).toBe(404);
    expect(existsSync(fileFor(dir, KEY))).toBe(false);
  });

  it("ignores a cached file that is not a JPEG and refetches", async () => {
    writeFileSync(fileFor(dir, KEY), "<html>login</html>");
    const fetchFresh = vi.fn(async () => jpeg(3));

    const bytes = await cachedImage(KEY, TTL, fetchFresh);

    expect(fetchFresh).toHaveBeenCalledTimes(1);
    expect(Array.from(bytes)).toEqual(Array.from(jpeg(3)));
    expect(Array.from(readFileSync(fileFor(dir, KEY)))).toEqual(Array.from(jpeg(3)));
  });

  it("shares one fetch between concurrent misses for the same key", async () => {
    let calls = 0;
    const fetchFresh = vi.fn(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jpeg(4);
    });

    const results = await Promise.all([
      cachedImage(KEY, TTL, fetchFresh),
      cachedImage(KEY, TTL, fetchFresh),
      cachedImage(KEY, TTL, fetchFresh),
    ]);

    expect(calls).toBe(1);
    for (const bytes of results) expect(Array.from(bytes)).toEqual(Array.from(jpeg(4)));
  });

  it("writes the cached file with owner-only mode", async () => {
    if (process.platform === "win32") return;
    await cachedImage(KEY, TTL, async () => jpeg(1));
    expect(statSync(fileFor(dir, KEY)).mode & 0o777).toBe(0o600);
  });

  it("still returns the bytes when the cache write fails", async () => {
    // A regular file where the directory should be makes every write fail.
    const blocker = path.join(dir, "not-a-dir");
    writeFileSync(blocker, "x");
    setImageCacheDirForTests(blocker);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const bytes = await cachedImage(KEY, TTL, async () => jpeg(5));

    expect(Array.from(bytes)).toEqual(Array.from(jpeg(5)));
    expect(errorSpy).toHaveBeenCalledWith("[image-cache] write failed");
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("radarr.lan");
    }
  });
});

describe("pruneImageCache", () => {
  it("deletes the oldest files until the total is at most 90% of the cap", async () => {
    // Three 40-byte files = 120 bytes against a cap of 100, so the target is 90.
    const names = ["a.jpg", "b.jpg", "c.jpg"];
    names.forEach((name, index) => {
      const file = path.join(dir, name);
      writeFileSync(file, Buffer.alloc(40, 1));
      age(file, (3 - index) * DAY);
    });

    await pruneImageCache(dir, 100);

    expect(readdirSync(dir).sort()).toEqual(["b.jpg", "c.jpg"]);
  });

  it("leaves the cache alone when it is under the cap", async () => {
    const file = path.join(dir, "a.jpg");
    writeFileSync(file, Buffer.alloc(40, 1));
    age(file, 30 * DAY);

    await pruneImageCache(dir, 100);

    expect(readdirSync(dir)).toEqual(["a.jpg"]);
  });

  it("removes temp files older than an hour and keeps newer ones", async () => {
    const old = path.join(dir, "x.jpg.abcd.tmp");
    const fresh = path.join(dir, "y.jpg.efgh.tmp");
    writeFileSync(old, "partial");
    writeFileSync(fresh, "partial");
    age(old, 2 * 60 * 60 * 1000);

    await pruneImageCache(dir, MAX_CACHE_BYTES);

    expect(readdirSync(dir)).toEqual(["y.jpg.efgh.tmp"]);
  });
});

describe("stale back-off", () => {
  it("serves the stale copy without retrying the upstream for a while after a failure", async () => {
    const file = fileFor(dir, KEY);
    writeFileSync(file, jpeg(1));
    age(file, TTL + 1000);
    const failing = vi.fn(async () => {
      throw new ArrRequestError("Radarr poster request failed: timed out", "timeout");
    });

    expect(Array.from(await cachedImage(KEY, TTL, failing))).toEqual(Array.from(jpeg(1)));
    expect(Array.from(await cachedImage(KEY, TTL, failing))).toEqual(Array.from(jpeg(1)));
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe("cachedArrImage", () => {
  afterEach(() => {
    connections.radarr = { url: "http://radarr.lan:7878", apiKey: "k" };
  });

  it("keys by app, saved URL, kind and id", async () => {
    await cachedArrImage("radarr", "poster", 123, async () => jpeg(1));
    expect(existsSync(fileFor(dir, KEY))).toBe(true);
    expect(statSync(fileFor(dir, KEY)).mtimeMs).toBeGreaterThan(Date.now() - ARR_IMAGE_TTL_MS);
  });

  it("does not share images between instances at different URLs", async () => {
    await cachedArrImage("radarr", "poster", 123, async () => jpeg(1));
    connections.radarr = { url: "http://other.lan:7878", apiKey: "k" };
    const fetchFresh = vi.fn(async () => jpeg(2));
    expect(Array.from(await cachedArrImage("radarr", "poster", 123, fetchFresh))).toEqual(Array.from(jpeg(2)));
    expect(fetchFresh).toHaveBeenCalledTimes(1);
  });

  it("does not share a poster with the backdrop of the same id", async () => {
    await cachedArrImage("radarr", "poster", 123, async () => jpeg(1));
    const fetchFresh = vi.fn(async () => jpeg(2));
    await cachedArrImage("radarr", "backdrop", 123, fetchFresh);
    expect(fetchFresh).toHaveBeenCalledTimes(1);
  });

  it("fetches uncached and writes nothing when no connection is saved", async () => {
    connections.radarr = null;
    const fetchFresh = vi.fn(async () => jpeg(1));
    await cachedArrImage("radarr", "poster", 123, fetchFresh);
    expect(fetchFresh).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir)).toEqual([]);
  });
});

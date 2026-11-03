import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BACKDROP_BYTES, MAX_POSTER_BYTES, fetchPosterBytes, isJpeg, readCapped, servePosterResponse } from "./poster";
import { ArrRequestError } from "./request";

function streamOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
}

/** A typed-client stand-in: a successful reply whose body is the given stream. */
function replyWith(body: ReadableStream<Uint8Array> | null) {
  return async () => ({ data: body, response: new Response(null, { status: 200 }) });
}

describe("isJpeg", () => {
  it("accepts the JPEG start-of-image bytes", () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
  });

  it("rejects anything else, including a short or empty body", () => {
    expect(isJpeg(new TextEncoder().encode("<html>"))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(isJpeg(new Uint8Array(0))).toBe(false);
  });
});

describe("readCapped", () => {
  it("joins the chunks in order", async () => {
    const bytes = await readCapped(streamOf([1, 2], [3]), 10);
    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3]);
  });

  it("returns an empty array for a missing body", async () => {
    expect(Array.from((await readCapped(null, 10)) ?? [])).toEqual([]);
  });

  it("returns null as soon as the body goes over the cap", async () => {
    expect(await readCapped(streamOf([1, 2], [3, 4]), 3)).toBeNull();
  });

  it("accepts a body of exactly the cap", async () => {
    const bytes = await readCapped(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_POSTER_BYTES));
        controller.close();
      },
    }), MAX_POSTER_BYTES);
    expect(bytes?.byteLength).toBe(MAX_POSTER_BYTES);
  });
});

describe("fetchPosterBytes", () => {
  it("joins a body that arrives in several chunks", async () => {
    const body = await fetchPosterBytes("Test poster", replyWith(streamOf([0xff, 0xd8], [0xff, 0xe0, 0x01])));
    expect(Array.from(body)).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x01]);
  });

  it("throws an invalid ArrRequestError, named with the label, for a body that is not a JPEG", async () => {
    const error = await fetchPosterBytes("Test poster", replyWith(streamOf([0x3c, 0x21]))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
    expect((error as ArrRequestError).message).toBe("Test poster response was not a usable image");
  });

  it("stops reading an oversized body once it passes the cap", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0xff);
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });

    const error = await fetchPosterBytes("Test poster", replyWith(body)).catch((e: unknown) => e);

    expect((error as ArrRequestError).kind).toBe("invalid");
    expect(cancelled).toBe(true);
    // 2 MiB cap with 1 MiB chunks: the third chunk goes over. Allow one extra for stream read-ahead.
    expect(pulls).toBeLessThanOrEqual(4);
  });

  it("rejects a JPEG one byte over MAX_POSTER_BYTES, so only the size cap can reject it", async () => {
    const body = new Uint8Array(MAX_POSTER_BYTES + 1);
    body.set([0xff, 0xd8, 0xff]);
    const error = await fetchPosterBytes("Test poster", replyWith(new Response(body).body)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("invalid");
  });

  it("uses a caller's cap instead of the poster cap when one is given", async () => {
    const body = new Uint8Array(MAX_POSTER_BYTES + 1);
    body.set([0xff, 0xd8, 0xff]);
    const bytes = await fetchPosterBytes("Test backdrop", replyWith(new Response(body).body), MAX_BACKDROP_BYTES);
    expect(bytes.byteLength).toBe(MAX_POSTER_BYTES + 1);
  });

  it("still rejects a body over the caller's cap", async () => {
    const body = new Uint8Array(MAX_BACKDROP_BYTES + 1);
    body.set([0xff, 0xd8, 0xff]);
    const error = await fetchPosterBytes("Test backdrop", replyWith(new Response(body).body), MAX_BACKDROP_BYTES).catch(
      (e: unknown) => e,
    );
    expect((error as ArrRequestError).kind).toBe("invalid");
  });

  it("accepts a JPEG of exactly MAX_POSTER_BYTES", async () => {
    const body = new Uint8Array(MAX_POSTER_BYTES);
    body.set([0xff, 0xd8, 0xff]);
    const bytes = await fetchPosterBytes("Test poster", replyWith(new Response(body).body));
    expect(bytes.byteLength).toBe(MAX_POSTER_BYTES);
  });

  it("reports a body that fails mid-read as a network error, without the underlying message", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
        controller.error(new TypeError("socket reset by http://radarr.test:7878 fake-key"));
      },
    });

    const error = await fetchPosterBytes("Test poster", replyWith(body)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).kind).toBe("network");
    expect((error as ArrRequestError).message).toBe("Test poster request failed: network error");
  });
});

describe("servePosterResponse", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("returns the bytes with only the three poster headers and passes the parsed id to the fetcher", async () => {
    const fetchPoster = vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff]));
    const res = await servePosterResponse("42", fetchPoster);
    expect(fetchPoster).toHaveBeenCalledWith(42);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect([...res.headers.keys()].sort()).toEqual(["cache-control", "content-type", "x-content-type-options"]);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff]);
  });

  it.each(["0", "01", "1.5", "2147483648"])("returns 400 for id %j without calling the fetcher", async (id) => {
    const fetchPoster = vi.fn(async () => new Uint8Array([0xff]));
    const res = await servePosterResponse(id, fetchPoster);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid id" });
    expect(fetchPoster).not.toHaveBeenCalled();
  });

  it("returns a fixed 502 for an ArrRequestError and logs one line with the tag", async () => {
    const fetchPoster = vi.fn(async () => {
      throw new ArrRequestError("Sonarr poster request failed: HTTP 500", "http", 500);
    });
    const res = await servePosterResponse("42", fetchPoster);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "poster unavailable" });
    expect(text).not.toContain("HTTP 500");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[poster] Sonarr poster request failed: HTTP 500");
  });

  it("returns a plain 404 without logging when the upstream has no such file", async () => {
    const fetchPoster = vi.fn(async () => {
      throw new ArrRequestError("Sonarr backdrop request failed: HTTP 404", "http", 404);
    });
    const res = await servePosterResponse("42", fetchPoster, "backdrop");
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "not found" });
    expect(text).not.toContain("HTTP 404");
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["a timeout", new ArrRequestError("Sonarr poster timed out", "timeout")],
    ["an invalid image", new ArrRequestError("Sonarr poster response was not a usable image", "invalid")],
  ])("still returns 502 and logs for %s", async (_name, error) => {
    const fetchPoster = vi.fn(async () => {
      throw error;
    });
    const res = await servePosterResponse("42", fetchPoster);
    expect(res.status).toBe(502);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("rethrows errors that are not ArrRequestError", async () => {
    const fetchPoster = vi.fn(async () => {
      throw new Error("Sonarr isn't set up");
    });
    await expect(servePosterResponse("42", fetchPoster)).rejects.toThrow("isn't set up");
  });
});

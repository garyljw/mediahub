import "server-only";
import { describe, expect, it } from "vitest";
import { MAX_POSTER_BYTES, isJpeg, readCapped } from "./poster";

function streamOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
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

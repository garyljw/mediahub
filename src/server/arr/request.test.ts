import "server-only";
import { describe, expect, it, vi } from "vitest";
import { ARR_TIMEOUT_MS, ArrRequestError, DELETE_TIMEOUT_MS, arrRequest, getList } from "./request";

describe("arrRequest", () => {
  it("returns the data when the response is OK", async () => {
    const data = await arrRequest("Radarr test", async () => ({ data: { ok: 1 }, response: new Response(null, { status: 200 }) }));
    expect(data).toEqual({ ok: 1 });
  });

  it("throws with the HTTP status on a non-OK response, keeping the message text", async () => {
    const error = await arrRequest("Radarr test", async () => ({ data: undefined, response: new Response(null, { status: 404 }) })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Radarr test request failed: HTTP 404");
    expect((error as ArrRequestError).status).toBe(404);
    expect((error as ArrRequestError).kind).toBe("http");
  });

  it("leaves status unset for a timeout", async () => {
    const error = await arrRequest("Radarr test", async () => {
      throw new DOMException("timed out", "TimeoutError");
    }).catch((e: unknown) => e);
    expect((error as ArrRequestError).kind).toBe("timeout");
    expect((error as ArrRequestError).status).toBeUndefined();
  });
});

describe("getList", () => {
  it("returns the list when the reply is an array", async () => {
    const rows = await getList("Radarr test", async () => ({ data: [{ id: 1 }], response: new Response(null, { status: 200 }) }));
    expect(rows).toEqual([{ id: 1 }]);
  });

  it("rejects a reply that is not a list as invalid, without the reply body", async () => {
    const error = await getList("Radarr test", async () => ({
      data: { notAList: true } as unknown as never[],
      response: new Response(null, { status: 200 }),
    })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrRequestError);
    expect((error as ArrRequestError).message).toBe("Radarr test response was not a list");
    expect((error as ArrRequestError).kind).toBe("invalid");
  });

  it("passes the timeout through to the request", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await getList("Radarr test", async () => ({ data: [], response: new Response(null, { status: 200 }) }), { timeoutMs: 1234 });
    expect(timeout).toHaveBeenCalledWith(1234);
    timeout.mockRestore();
  });
});

describe("DELETE_TIMEOUT_MS", () => {
  it("is longer than the normal read timeout, because deleting files can be slow", () => {
    expect(DELETE_TIMEOUT_MS).toBeGreaterThan(ARR_TIMEOUT_MS);
  });
});

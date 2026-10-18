import "server-only";
import { describe, expect, it } from "vitest";
import { ArrRequestError, arrRequest } from "./request";

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

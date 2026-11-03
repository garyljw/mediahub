import "server-only";
import { describe, expect, it, vi } from "vitest";
import {
  ARR_TIMEOUT_MS,
  ArrRequestError,
  DELETE_TIMEOUT_MS,
  arrRequest,
  getList,
  settledOrNull,
  writeFailureMessage,
} from "./request";

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

describe("settledOrNull", () => {
  it("returns the value of a fulfilled request", () => {
    expect(settledOrNull({ status: "fulfilled", value: [1] }, "Queue page")).toEqual([1]);
  });

  it("logs an ArrRequestError as label: message and gives null", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const reason = new ArrRequestError("Radarr queue request failed: HTTP 500", "http", 500);

    expect(settledOrNull({ status: "rejected", reason }, "Queue page")).toBeNull();
    expect(log).toHaveBeenCalledWith("Queue page: Radarr queue request failed: HTTP 500");
    log.mockRestore();
  });

  it("rethrows anything that is not an ArrRequestError", () => {
    const reason = new Error("config broke");
    expect(() => settledOrNull({ status: "rejected", reason }, "Queue page")).toThrow(reason);
  });
});

describe("writeFailureMessage", () => {
  const OUTCOME = { done: "removed", check: "check the queue" };

  it("says the app didn't accept a 4xx, so the user can try again", () => {
    const error = new ArrRequestError("x", "http", 404);
    expect(writeFailureMessage(error, "Radarr", OUTCOME)).toBe("Radarr didn't accept it. Try again.");
    expect(writeFailureMessage(error, "Sonarr", OUTCOME)).toBe("Sonarr didn't accept it. Try again.");
  });

  it("says the app didn't confirm a timeout, and that the change may have been made", () => {
    const error = new ArrRequestError("x", "timeout");
    expect(writeFailureMessage(error, "Sonarr", OUTCOME)).toBe(
      "Sonarr didn't confirm it. It may still have been removed, so check the queue.",
    );
  });

  it("says the app didn't confirm a 5xx", () => {
    const error = new ArrRequestError("x", "http", 500);
    expect(writeFailureMessage(error, "Radarr", { done: "marked failed", check: "reload the page to check" })).toBe(
      "Radarr didn't confirm it. It may still have been marked failed, so reload the page to check.",
    );
  });

  it("says the app isn't set up yet when no connection is saved, so nothing was sent", () => {
    const error = new ArrRequestError("Radarr isn't set up", "unconfigured");
    expect(writeFailureMessage(error, "Radarr", OUTCOME)).toBe(
      "Radarr isn't set up yet. An admin can add it in Settings.",
    );
  });

  it("treats an error with no status (a network failure or broken reply) as not confirmed", () => {
    const error = new ArrRequestError("x", "network");
    expect(writeFailureMessage(error, "Radarr", OUTCOME)).toBe(
      "Radarr didn't confirm it. It may still have been removed, so check the queue.",
    );
  });
});

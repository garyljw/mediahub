import "server-only";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ httpsRequest: vi.fn() }));

vi.mock("node:https", () => ({ request: mocks.httpsRequest }));
vi.mock("@/server/plex/data-connection", () => ({ getPlexDataClientId: () => CLIENT_ID }));

import { getLibrarySections, getSectionItems, getServerIdentity, pinnedLookup } from "./server";
import { PlexRequestError } from "./errors";

const CLIENT_ID = "mediahub-data-fake-client-id";
const TOKEN = "fake-plex-data-token-0123456789abcdef";
const PLAIN = { url: "http://192.168.10.5:32400", pinAddress: null };
const PINNED = { url: "https://192-168-10-5.fakehash.plex.direct:32400", pinAddress: "192.168.10.5" };

const IDENTITY = { MediaContainer: { machineIdentifier: "fakemachineid0123456789abcdef0123456789", size: 0 } };
const SECTIONS = {
  MediaContainer: {
    size: 2,
    Directory: [
      { key: "1", type: "movie", title: "Movies", agent: "tv.plex.agents.movie" },
      { key: "2", type: "show", title: "TV Shows", agent: "tv.plex.agents.series" },
    ],
  },
};

const fetchMock = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Fakes node:https.request. `reply` is the HTTP status and body text, or an Error that the request fails with.
 * Returns the mock so tests can read the options it was called with.
 */
function fakeHttps(reply: { status: number; body: string } | Error) {
  mocks.httpsRequest.mockImplementation((_url: URL, _options: unknown, callback: (res: unknown) => void) => {
    const request = Object.assign(new EventEmitter(), {
      end: () => {
        process.nextTick(() => {
          if (reply instanceof Error) {
            request.emit("error", reply);
            return;
          }
          const response = Object.assign(new EventEmitter(), { statusCode: reply.status, resume: () => {} });
          callback(response);
          response.emit("data", Buffer.from(reply.body));
          response.emit("end");
        });
      },
      destroy: () => {},
    });
    return request;
  });
  return mocks.httpsRequest;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("plain http requests", () => {
  it("sends the token only in X-Plex-Token, never in the URL", async () => {
    fetchMock.mockResolvedValue(json(SECTIONS));
    await getLibrarySections(PLAIN, TOKEN);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("http://192.168.10.5:32400/library/sections");
    expect(String(url)).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>)["X-Plex-Token"]).toBe(TOKEN);
  });

  it("sends the data client id and product on every request", async () => {
    fetchMock.mockResolvedValue(json(IDENTITY));
    await getServerIdentity(PLAIN);

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "X-Plex-Client-Identifier": CLIENT_ID,
      "X-Plex-Product": "MediaHub",
    });
    expect((init.headers as Record<string, string>)["X-Plex-Token"]).toBeUndefined();
  });

  it("refuses redirects and sets a timeout signal", async () => {
    fetchMock.mockResolvedValue(json(IDENTITY));
    await getServerIdentity(PLAIN);

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the machine identifier and the libraries, with only the fields we keep", async () => {
    fetchMock.mockResolvedValueOnce(json(IDENTITY));
    await expect(getServerIdentity(PLAIN)).resolves.toBe("fakemachineid0123456789abcdef0123456789");

    fetchMock.mockResolvedValueOnce(json(SECTIONS));
    await expect(getLibrarySections(PLAIN, TOKEN)).resolves.toEqual([
      { key: "1", type: "movie", title: "Movies" },
      { key: "2", type: "show", title: "TV Shows" },
    ]);
  });

  it("treats a server with no libraries as an empty list", async () => {
    fetchMock.mockResolvedValue(json({ MediaContainer: { size: 0 } }));
    await expect(getLibrarySections(PLAIN, TOKEN)).resolves.toEqual([]);
  });

  it("maps a timeout to kind timeout", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(getServerIdentity(PLAIN)).rejects.toMatchObject({ kind: "timeout" });
  });

  it("maps a network failure to kind network, without the underlying message", async () => {
    fetchMock.mockRejectedValue(new TypeError(`fetch failed for http://192.168.10.5:32400/identity?X-Plex-Token=${TOKEN}`));
    const error = await getServerIdentity(PLAIN).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "network" });
    expect(String((error as Error).message)).not.toContain(TOKEN);
  });

  it("maps a non-OK status to kind http with the status", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(getLibrarySections(PLAIN, TOKEN)).rejects.toMatchObject({ kind: "http", status: 401 });
  });

  it("maps a body that is not JSON to kind invalid", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(getServerIdentity(PLAIN)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("rejects a reply that doesn't have the expected shape", async () => {
    fetchMock.mockResolvedValue(json({ MediaContainer: { size: 0 } }));
    const error = await getServerIdentity(PLAIN).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlexRequestError);
    expect(error).toMatchObject({ kind: "invalid" });
  });

  it("names the step in the message, never the URL or body", async () => {
    fetchMock.mockResolvedValue(new Response("secret body", { status: 500 }));
    const error = (await getLibrarySections(PLAIN, TOKEN).catch((e: unknown) => e)) as PlexRequestError;
    expect(error.message).toBe("Plex library sections request failed: HTTP 500");
    expect(error.message).not.toContain("secret body");
  });
});

describe("pinned https requests", () => {
  it("uses node:https with a lookup pinned to the listed address, and default certificate checking", async () => {
    const mock = fakeHttps({ status: 200, body: JSON.stringify(IDENTITY) });
    await expect(getServerIdentity(PINNED)).resolves.toBe("fakemachineid0123456789abcdef0123456789");

    const [url, options] = mock.mock.calls[0] as [URL, Record<string, unknown>];
    expect(url.hostname).toBe("192-168-10-5.fakehash.plex.direct");
    expect(url.pathname).toBe("/identity");
    expect(options.lookup).toBeTypeOf("function");
    expect(options).not.toHaveProperty("rejectUnauthorized");
    expect(options).not.toHaveProperty("servername");
    expect(options.headers).toMatchObject({ "X-Plex-Client-Identifier": CLIENT_ID, "X-Plex-Product": "MediaHub" });
    expect(options.headers).not.toHaveProperty("X-Plex-Token");
  });

  it("sends the token in the header only", async () => {
    const mock = fakeHttps({ status: 200, body: JSON.stringify(SECTIONS) });
    await getLibrarySections(PINNED, TOKEN);

    const [url, options] = mock.mock.calls[0] as [URL, Record<string, unknown>];
    expect(url.toString()).not.toContain(TOKEN);
    expect(options.headers).toMatchObject({ "X-Plex-Token": TOKEN });
  });

  it("treats a redirect as an http failure", async () => {
    fakeHttps({ status: 301, body: "" });
    await expect(getServerIdentity(PINNED)).rejects.toMatchObject({ kind: "http", status: 301 });
  });

  it("maps a request aborted by its timeout to kind timeout", async () => {
    mocks.httpsRequest.mockImplementation((_url: URL, options: { signal: AbortSignal }) => {
      const request = Object.assign(new EventEmitter(), {
        end: () => {
          options.signal.addEventListener("abort", () =>
            request.emit("error", Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        },
        destroy: () => {},
      });
      return request;
    });
    await expect(getServerIdentity(PINNED, { timeoutMs: 5 })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("maps an AbortError that was not our timeout to kind network", async () => {
    fakeHttps(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(getServerIdentity(PINNED)).rejects.toMatchObject({ kind: "network" });
  });

  it("maps a socket failure to kind network", async () => {
    fakeHttps(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
    const error = await getServerIdentity(PINNED).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "network" });
    expect(String((error as Error).message)).not.toContain("ENOTFOUND");
  });

  it("maps a body that is not JSON to kind invalid", async () => {
    fakeHttps({ status: 200, body: "not json" });
    await expect(getServerIdentity(PINNED)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("rejects a reply with the wrong shape", async () => {
    fakeHttps({ status: 200, body: JSON.stringify({ MediaContainer: { machineIdentifier: 7 } }) });
    await expect(getServerIdentity(PINNED)).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("pinnedLookup", () => {
  it("answers with the pinned IPv4 address in the single-address shape", () => {
    const callback = vi.fn();
    pinnedLookup("192.168.10.5")("192-168-10-5.fakehash.plex.direct", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "192.168.10.5", 4);
  });

  it("answers with the pinned address in the all-addresses shape", () => {
    const callback = vi.fn();
    pinnedLookup("192.168.10.5")("192-168-10-5.fakehash.plex.direct", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "192.168.10.5", family: 4 }]);
  });

  it("uses family 6 for an IPv6 pin", () => {
    const callback = vi.fn();
    pinnedLookup("2001:db8::5")("2001-db8--5.fakehash.plex.direct", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "2001:db8::5", 6);
  });
});

describe("getSectionItems", () => {
  const ITEMS = {
    MediaContainer: {
      size: 3,
      Metadata: [
        {
          ratingKey: "101",
          title: "Fake Film",
          duration: 5400000,
          Guid: [{ id: "imdb://tt0000001" }, { id: "tmdb://900001" }],
          viewCount: 2,
        },
        { ratingKey: "102", title: "Fake Show", Guid: [{ id: "tvdb://100001" }], leafCount: 10, viewedLeafCount: 4 },
        { ratingKey: "103", title: "Untouched" },
      ],
    },
  };

  it("keeps only the watched-status fields, dropping every other key", async () => {
    fetchMock.mockResolvedValue(json(ITEMS));
    await expect(getSectionItems(PLAIN, TOKEN, "1")).resolves.toEqual([
      { guids: ["imdb://tt0000001", "tmdb://900001"], viewCount: 2, viewOffset: 0, leafCount: 0, viewedLeafCount: 0 },
      { guids: ["tvdb://100001"], viewCount: 0, viewOffset: 0, leafCount: 10, viewedLeafCount: 4 },
      { guids: [], viewCount: 0, viewOffset: 0, leafCount: 0, viewedLeafCount: 0 },
    ]);
  });

  it("asks for guids on the encoded section path, with the token in the header only", async () => {
    fetchMock.mockResolvedValue(json({ MediaContainer: { size: 0 } }));
    await getSectionItems(PLAIN, TOKEN, "1/../2");

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("http://192.168.10.5:32400/library/sections/1%2F..%2F2/all?includeGuids=1");
    expect(String(url)).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>)["X-Plex-Token"]).toBe(TOKEN);
  });

  it("treats a section with no Metadata as an empty list", async () => {
    fetchMock.mockResolvedValue(json({ MediaContainer: { size: 0 } }));
    await expect(getSectionItems(PLAIN, TOKEN, "1")).resolves.toEqual([]);
  });

  it("rejects a plain http reply whose Content-Length is over the section cap", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(ITEMS), {
        status: 200,
        headers: { "Content-Type": "application/json", "Content-Length": String(17 * 1024 * 1024) },
      }),
    );
    await expect(getSectionItems(PLAIN, TOKEN, "1")).rejects.toMatchObject({ kind: "invalid" });
  });

  it("rejects a plain http body that is over the section cap even with no Content-Length", async () => {
    const padding = "x".repeat(16 * 1024 * 1024);
    fetchMock.mockResolvedValue(new Response(`{"MediaContainer":{"size":0,"pad":"${padding}"}}`, { status: 200 }));
    await expect(getSectionItems(PLAIN, TOKEN, "1")).rejects.toMatchObject({ kind: "invalid" });
  });

  it("stops reading a plain http body once it passes the cap, without buffering the rest", async () => {
    let pulls = 0;
    const chunk = new Uint8Array(512 * 1024);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
    });
    fetchMock.mockResolvedValue(new Response(endless, { status: 200 }));
    await expect(getServerIdentity(PLAIN)).rejects.toMatchObject({ kind: "invalid" });
    expect(pulls).toBeLessThan(10);
  });

  it("keeps the default 1 MB cap for other plain http requests", async () => {
    const padding = "x".repeat(1024 * 1024 + 1);
    fetchMock.mockResolvedValue(new Response(`{"MediaContainer":{"machineIdentifier":"abc","pad":"${padding}"}}`, { status: 200 }));
    await expect(getServerIdentity(PLAIN)).rejects.toMatchObject({ kind: "invalid" });
  });
});

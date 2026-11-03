import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FAKE_KEY, fakeConnections } = vi.hoisted(() => {
  const key = "fake-api-key-0123456789abcdefghi"; // 32 chars, not a real secret
  return {
    FAKE_KEY: key,
    fakeConnections: {
      radarr: { url: "http://radarr.test:7878", apiKey: key },
      sonarr: { url: "http://sonarr.test:8989", apiKey: key },
    },
  };
});

const connectionMock = vi.hoisted(() => ({ unset: false }));

vi.mock("@/server/settings/connections", () => ({
  getConnection: (app: "radarr" | "sonarr") => (connectionMock.unset ? null : fakeConnections[app]),
}));

import { getRadarrStatus, getSonarrStatus } from "./system";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestAt(call: number): Request {
  return fetchMock.mock.calls[call][0] as Request;
}

describe.each([
  {
    name: "Radarr",
    host: "http://radarr.test:7878",
    getStatus: getRadarrStatus,
    appName: "Radarr",
  },
  {
    name: "Sonarr",
    host: "http://sonarr.test:8989",
    getStatus: getSonarrStatus,
    appName: "Sonarr",
  },
])("$name system status", ({ name, host, getStatus, appName }) => {
  it("calls /api/v3/system/status on the configured host with the key in a header", async () => {
    fetchMock.mockResolvedValue(json({ version: "1.2.3", appName }));

    await getStatus();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("GET");
    const url = new URL(req.url);
    expect(`${url.protocol}//${url.host}`).toBe(host);
    expect(url.pathname).toBe("/api/v3/system/status");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
  });

  it("refuses redirects so the key header is never forwarded", async () => {
    fetchMock.mockResolvedValue(json({ version: "1.2.3", appName }));

    await getStatus();

    expect(requestAt(0).redirect).toBe("error");
  });

  it("never puts the key or apikey parameter in the request URL", async () => {
    fetchMock.mockResolvedValue(json({ version: "1.2.3", appName }));

    await getStatus();

    const url = requestAt(0).url;
    expect(url).not.toContain("apikey");
    expect(url).not.toContain(FAKE_KEY);
  });

  it("returns only version and appName, even when upstream sends extra fields", async () => {
    fetchMock.mockResolvedValue(
      json({
        version: "6.4.4.10685",
        appName,
        instanceName: name,
        buildTime: "2026-01-01T00:00:00Z",
        apiKey: FAKE_KEY,
        osName: "linux",
      }),
    );

    const status = await getStatus();

    expect(status).toEqual({ version: "6.4.4.10685", appName });
    expect(Object.keys(status).sort()).toEqual(["appName", "version"]);
    expect(JSON.stringify(status)).not.toContain(FAKE_KEY);
  });

  it("throws on HTTP 401 without leaking the key or host", async () => {
    fetchMock.mockResolvedValue(
      new Response(`Unauthorized: bad key ${FAKE_KEY} at ${host}`, { status: 401 }),
    );

    const error = await getStatus().then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e as Error,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(`${name} status request failed: HTTP 401`);
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain("radarr.test");
    expect(error.message).not.toContain("sonarr.test");
  });

  it("throws a generic error on network failure without exposing the host", async () => {
    fetchMock.mockRejectedValue(new TypeError(`fetch failed for ${host}`));

    const error = await getStatus().then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e as Error,
    );

    expect(error.message).toBe(`${name} status request failed: network error`);
    expect(error.message).not.toContain(host);
  });
});

describe("unconfigured connection", () => {
  afterEach(() => {
    connectionMock.unset = false;
  });

  it.each([
    ["getRadarrStatus", "Radarr"],
    ["getSonarrStatus", "Sonarr"],
  ] as const)("%s rejects with an unconfigured error and sends no request", async (fn, name) => {
    vi.resetModules(); // drop memoized clients
    connectionMock.unset = true;
    const mod = await import("./system");

    const error = await mod[fn]().then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e as Error & { kind?: string },
    );

    expect(error).toMatchObject({ name: "ArrRequestError", kind: "unconfigured" });
    expect(error.message).toBe(`${name} isn't set up`);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

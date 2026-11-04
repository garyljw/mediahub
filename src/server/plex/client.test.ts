import "server-only";
import { afterEach, describe, expect, it, vi } from "vitest";
import resourcesFixture from "./__fixtures__/resources.json";
import {
  authAppUrl,
  checkPin,
  createPin,
  getOwnedServers,
  getPlexAccount,
  getServerConnections,
  PlexRequestError,
} from "./client";

vi.mock("@/server/env", () => ({ env: () => ({ BETTER_AUTH_URL: "http://mediahub.test:3000" }) }));
vi.mock("./client-id", () => ({ getPlexClientId: () => CLIENT_ID }));

const CLIENT_ID = "mediahub-fake-client-id";
const TOKEN = "fake-plex-token-0123456789abcdef";

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Replaces fetch with a router and returns the mock so tests can read the requests it received. */
function stubPlex(route: Route) {
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => route(new URL(String(input)), init ?? {}));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function requestedHeaders(mock: ReturnType<typeof stubPlex>, index = 0): Record<string, string> {
  return mock.mock.calls[index][1]!.headers as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPin", () => {
  it("sends POST to /api/v2/pins?strong=true with no body", async () => {
    const mock = stubPlex(() => json({ id: 7, code: "fake-code" }));
    await expect(createPin()).resolves.toEqual({ id: 7, code: "fake-code" });
    const url = new URL(String(mock.mock.calls[0][0]));
    expect(url.origin).toBe("https://plex.tv");
    expect(url.pathname).toBe("/api/v2/pins");
    expect(url.searchParams.get("strong")).toBe("true");
    expect(mock.mock.calls[0][1]!.method).toBe("POST");
    expect(mock.mock.calls[0][1]!.body).toBeUndefined();
    expect(requestedHeaders(mock)["Content-Type"]).toBeUndefined();
  });

  it("sends no deviceJWT and no key material", async () => {
    const mock = stubPlex(() => json({ id: 7, code: "fake-code" }));
    await createPin();
    expect(String(mock.mock.calls[0][0])).not.toContain("deviceJWT");
  });
});

describe("authAppUrl", () => {
  it("builds the sign-in fragment with the fixed client id and product", () => {
    const url = authAppUrl({ code: "fake-pin-code" });
    expect(url.startsWith("https://app.plex.tv/auth#?")).toBe(true);
    const params = new URLSearchParams(url.split("#?")[1]);
    expect(params.get("clientID")).toBe(CLIENT_ID);
    expect(params.get("code")).toBe("fake-pin-code");
    expect(params.get("context[device][product]")).toBe("MediaHub");
    expect(params.has("forwardUrl")).toBe(false);
  });

  it("resolves forwardPath against MediaHub's own address", () => {
    const url = authAppUrl({ code: "fake-pin-code", forwardPath: "/api/auth/plex/callback?state=x&y=1" });
    expect(new URLSearchParams(url.split("#?")[1]).get("forwardUrl")).toBe(
      "http://mediahub.test:3000/api/auth/plex/callback?state=x&y=1",
    );
  });

  it.each(["//evil.test/x", "https://evil.test/x", "evil.test/x", "/\\evil.test/x"])(
    "refuses a forwardPath that could leave MediaHub: %s",
    (forwardPath) => {
      expect(() => authAppUrl({ code: "fake-pin-code", forwardPath })).toThrow();
    },
  );
});

describe("checkPin", () => {
  it("makes exactly one GET to the PIN, with no deviceJWT", async () => {
    const mock = stubPlex(() => json({ id: 42, authToken: null }));
    await expect(checkPin(42)).resolves.toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
    const url = new URL(String(mock.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/v2/pins/42");
    expect(url.search).toBe("");
    expect(mock.mock.calls[0][1]!.method).toBe("GET");
    expect(String(mock.mock.calls[0][0])).not.toContain("deviceJWT");
  });

  it("returns null while the PIN is unapproved", async () => {
    stubPlex(() => json({ id: 42, authToken: null }));
    await expect(checkPin(42)).resolves.toBeNull();
  });

  it("returns the token once approved", async () => {
    const mock = stubPlex(() => json({ id: 42, authToken: TOKEN }));
    await expect(checkPin(42)).resolves.toBe(TOKEN);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("requests", () => {
  it("sends the three identity headers on every call, with the fixed client id", async () => {
    const mock = stubPlex(() => json({ id: 1, username: "fake-user" }));
    await getPlexAccount(TOKEN);
    expect(requestedHeaders(mock)).toMatchObject({
      Accept: "application/json",
      "X-Plex-Client-Identifier": CLIENT_ID,
      "X-Plex-Product": "MediaHub",
    });
  });

  it("uses the same client id for every kind of request", async () => {
    const mock = stubPlex((url) => {
      if (url.pathname === "/api/v2/pins") return json({ id: 7, code: "fake-code" });
      if (url.pathname.startsWith("/api/v2/pins/")) return json({ id: 7, authToken: null });
      if (url.pathname === "/api/v2/user") return json({ id: 1, username: "fake-user" });
      return json([]);
    });
    await createPin();
    await checkPin(7);
    await getPlexAccount(TOKEN);
    await getOwnedServers(TOKEN);
    expect(mock).toHaveBeenCalledTimes(4);
    for (let index = 0; index < 4; index++) {
      expect(requestedHeaders(mock, index)["X-Plex-Client-Identifier"]).toBe(CLIENT_ID);
    }
  });

  it("sends the token only in X-Plex-Token, never in the URL", async () => {
    const mock = stubPlex(() => json({ id: 1, username: "fake-user" }));
    await getPlexAccount(TOKEN);
    expect(requestedHeaders(mock)["X-Plex-Token"]).toBe(TOKEN);
    expect(String(mock.mock.calls[0][0])).not.toContain(TOKEN);
  });

  it("sends no token on createPin or checkPin", async () => {
    const mock = stubPlex((url) =>
      url.pathname === "/api/v2/pins" ? json({ id: 7, code: "fake-code" }) : json({ id: 7, authToken: null }),
    );
    await createPin();
    await checkPin(7);
    expect(requestedHeaders(mock, 0)["X-Plex-Token"]).toBeUndefined();
    expect(requestedHeaders(mock, 1)["X-Plex-Token"]).toBeUndefined();
  });

  it("uses no redirects and a timeout signal", async () => {
    const mock = stubPlex(() => json({ id: 1, username: "fake-user" }));
    await getPlexAccount(TOKEN);
    const init = mock.mock.calls[0][1]!;
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the account with only the fields we keep", async () => {
    stubPlex(() => json({ id: 1000001, username: "fake-user", email: null, uuid: "fake-uuid", thumb: "x" }));
    await expect(getPlexAccount(TOKEN)).resolves.toEqual({ id: 1000001, username: "fake-user", email: null });
  });

  it("returns a missing email as null", async () => {
    stubPlex(() => json({ id: 1, username: "fake-user" }));
    await expect(getPlexAccount(TOKEN)).resolves.toMatchObject({ email: null });
  });

  it("returns the email when plex.tv sends one", async () => {
    stubPlex(() => json({ id: 1, username: "fake-user", email: "fake@example.test" }));
    await expect(getPlexAccount(TOKEN)).resolves.toMatchObject({ email: "fake@example.test" });
  });
});

describe("getOwnedServers", () => {
  it("keeps only owned servers, from the fixture", async () => {
    stubPlex(() => json(resourcesFixture));
    await expect(getOwnedServers(TOKEN)).resolves.toEqual([
      { clientIdentifier: "fakemachineid0123456789abcdef0123456789", name: "Fake Home Server" },
    ]);
  });

  it("requests the resources with includeHttps=1 and the token in its header", async () => {
    const mock = stubPlex(() => json([]));
    await getOwnedServers(TOKEN);
    const url = new URL(String(mock.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/v2/resources");
    expect(url.searchParams.get("includeHttps")).toBe("1");
    expect(requestedHeaders(mock)["X-Plex-Token"]).toBe(TOKEN);
  });

  it("skips owned entries that are not servers", async () => {
    stubPlex(() => json([{ name: "Fake Player", provides: "player", owned: true, clientIdentifier: "fake-player" }]));
    await expect(getOwnedServers(TOKEN)).resolves.toEqual([]);
  });

  it("skips an owned server with no name or clientIdentifier and keeps the rest", async () => {
    stubPlex(() =>
      json([
        { provides: "server", owned: true, clientIdentifier: "fake-no-name" },
        { name: "Fake No Id", provides: "server", owned: true },
        { name: "Fake Good", provides: "server", owned: true, clientIdentifier: "fake-good" },
      ]),
    );
    await expect(getOwnedServers(TOKEN)).resolves.toEqual([{ clientIdentifier: "fake-good", name: "Fake Good" }]);
  });
});

describe("failures", () => {
  it("maps a non-OK status to kind http and leaves the token out of the message", async () => {
    stubPlex(() => new Response(`{"authToken":"${TOKEN}"}`, { status: 401 }));
    const error = await getPlexAccount(TOKEN).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlexRequestError);
    expect(error).toMatchObject({ kind: "http", status: 401 });
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("maps a timeout to kind timeout", async () => {
    stubPlex(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(getPlexAccount(TOKEN)).rejects.toMatchObject({ kind: "timeout" });
  });

  it("maps a network error to kind network", async () => {
    stubPlex(() => {
      throw new TypeError("fetch failed");
    });
    await expect(getPlexAccount(TOKEN)).rejects.toMatchObject({ kind: "network" });
  });

  it("maps a body that is not JSON to kind invalid", async () => {
    stubPlex(() => new Response("<html>not json</html>", { status: 200 }));
    await expect(getPlexAccount(TOKEN)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("maps a reply that fails the schema to kind invalid", async () => {
    stubPlex(() => json({ id: "not-a-number", username: "fake-user" }));
    await expect(getPlexAccount(TOKEN)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("keeps the failure message free of the token when the reply is invalid", async () => {
    stubPlex(() => json({ id: "x", authToken: TOKEN }));
    const error = await getPlexAccount(TOKEN).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain(TOKEN);
  });
});

describe("data-connection calls", () => {
  const DATA_CLIENT_ID = "mediahub-data-fake-client-id";

  it("makes the calls as the data client id when given one, and sign-in calls keep the sign-in id", async () => {
    const mock = stubPlex((url) => {
      if (url.pathname === "/api/v2/pins") return json({ id: 7, code: "fake-code" });
      if (url.pathname.startsWith("/api/v2/pins/")) return json({ id: 7, authToken: null });
      return json({ id: 1, username: "fake-user" });
    });
    await createPin({ clientId: DATA_CLIENT_ID });
    await checkPin(7, { clientId: DATA_CLIENT_ID });
    await getPlexAccount(TOKEN, { clientId: DATA_CLIENT_ID });
    await getPlexAccount(TOKEN);

    expect(requestedHeaders(mock, 0)["X-Plex-Client-Identifier"]).toBe(DATA_CLIENT_ID);
    expect(requestedHeaders(mock, 1)["X-Plex-Client-Identifier"]).toBe(DATA_CLIENT_ID);
    expect(requestedHeaders(mock, 2)["X-Plex-Client-Identifier"]).toBe(DATA_CLIENT_ID);
    expect(requestedHeaders(mock, 3)["X-Plex-Client-Identifier"]).toBe(CLIENT_ID);
  });

  it("authAppUrl takes a client id and product for the data device, and no forwardUrl", () => {
    const url = authAppUrl({ code: "fake-pin-code", clientId: DATA_CLIENT_ID, product: "MediaHub watched status" });
    const params = new URLSearchParams(url.split("#?")[1]);
    expect(params.get("clientID")).toBe(DATA_CLIENT_ID);
    expect(params.get("context[device][product]")).toBe("MediaHub watched status");
    expect(params.has("forwardUrl")).toBe(false);
  });

  it("getServerConnections returns the owned server's addresses, validated", async () => {
    stubPlex(() =>
      json([
        {
          name: "Fake Home Server",
          provides: "server",
          owned: true,
          clientIdentifier: "fake-server-1",
          connections: [
            { protocol: "https", address: "192.168.10.5", port: 32400, uri: "https://192-168-10-5.x.plex.direct:32400", local: true, relay: false, IPv6: false },
          ],
        },
      ]),
    );
    await expect(getServerConnections(TOKEN, "fake-server-1", { clientId: DATA_CLIENT_ID })).resolves.toEqual([
      { protocol: "https", address: "192.168.10.5", port: 32400, uri: "https://192-168-10-5.x.plex.direct:32400", local: true, relay: false, IPv6: false },
    ]);
  });

  it("getServerConnections returns null when the account doesn't own that server", async () => {
    stubPlex(() => json([{ name: "Fake Friend", provides: "server", owned: false, clientIdentifier: "fake-server-1", connections: [] }]));
    await expect(getServerConnections(TOKEN, "fake-server-1")).resolves.toBeNull();
  });

  it("getServerConnections rejects a connection with the wrong shape", async () => {
    stubPlex(() =>
      json([{ name: "Fake", provides: "server", owned: true, clientIdentifier: "fake-server-1", connections: [{ protocol: "https" }] }]),
    );
    await expect(getServerConnections(TOKEN, "fake-server-1")).rejects.toMatchObject({ kind: "invalid" });
  });

  it("sign-in resources parsing still works when the connections list is malformed", async () => {
    stubPlex(() =>
      json([{ name: "Fake Home Server", provides: "server", owned: true, clientIdentifier: "fake-server-1", connections: [{ protocol: "https" }] }]),
    );
    await expect(getOwnedServers(TOKEN)).resolves.toEqual([{ clientIdentifier: "fake-server-1", name: "Fake Home Server" }]);
  });
});

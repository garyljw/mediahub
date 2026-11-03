import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getConnection: vi.fn(),
  saveConnection: vi.fn(),
  resetArrClients: vi.fn(),
  revalidatePath: vi.fn(),
}));

// AuthzError must be a real class: the actions check `instanceof AuthzError`.
vi.mock("@/server/authz", () => {
  class AuthzError extends Error {
    constructor(readonly status: 401 | 403) {
      super(status === 401 ? "unauthorized" : "forbidden");
      this.name = "AuthzError";
    }
  }
  return { AuthzError, requireRole: mocks.requireRole };
});

vi.mock("@/server/settings/connections", () => ({
  getConnection: mocks.getConnection,
  saveConnection: mocks.saveConnection,
}));

// The real client factories run, so the X-Api-Key header and URL are checked on the request fetch receives.
vi.mock("@/server/arr/client", async () => {
  const actual = await vi.importActual<typeof import("@/server/arr/client")>("@/server/arr/client");
  return { ...actual, resetArrClients: mocks.resetArrClients };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { AuthzError } from "@/server/authz";
import { saveConnectionSettings, testConnection } from "./actions";

const KEY = "typed-radarr-key-0123456789";
const STORED_KEY = "stored-radarr-key-0123456789";
const DENIED = "You don't have permission to change connections.";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function requestAt(call: number): Request {
  return fetchMock.mock.calls[call][0] as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.getConnection.mockReturnValue(null);
  fetchMock.mockResolvedValue(json({ version: "5.1.0", appName: "Radarr" }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const input = { app: "radarr", url: "http://radarr.test:7878", apiKey: KEY };

describe.each([
  ["testConnection", testConnection],
  ["saveConnectionSettings", saveConnectionSettings],
])("%s authorization", (_name, action) => {
  it("checks for the admin role", async () => {
    await action(input);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Radarr or saves", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await action(input)).toEqual({ ok: false, message: DENIED });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.saveConnection).not.toHaveBeenCalled();
    expect(mocks.resetArrClients).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Radarr or saves", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    expect(await action(input)).toEqual({ ok: false, message: DENIED });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.saveConnection).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(action(input)).rejects.toThrow("database down");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("testConnection", () => {
  it("checks the typed address and key, and returns only the app name and version", async () => {
    const result = await testConnection(input);

    expect(result).toEqual({ ok: true, appName: "Radarr", version: "5.1.0" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(0);
    expect(req.method).toBe("GET");
    expect(new URL(req.url).pathname).toBe("/api/v3/system/status");
    expect(req.headers.get("X-Api-Key")).toBe(KEY);
    expect(mocks.saveConnection).not.toHaveBeenCalled();
  });

  it("uses the stored key when no key is typed and the origin matches", async () => {
    mocks.getConnection.mockReturnValue({ url: "http://radarr.test:7878", apiKey: STORED_KEY });

    const result = await testConnection({ app: "radarr", url: "http://radarr.test:7878/", apiKey: "" });

    expect(result).toMatchObject({ ok: true });
    expect(requestAt(0).headers.get("X-Api-Key")).toBe(STORED_KEY);
  });

  it("asks for the key again, and sends nothing, when the origin changes", async () => {
    mocks.getConnection.mockReturnValue({ url: "http://radarr.test:7878", apiKey: STORED_KEY });

    const result = await testConnection({ app: "radarr", url: "http://other.test:7878" });

    expect(result).toEqual({
      ok: false,
      message: "Enter the API key again. It's needed when the address changes.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for a key when nothing is stored", async () => {
    const result = await testConnection({ app: "sonarr", url: "http://sonarr.test:8989" });

    expect(result).toEqual({ ok: false, message: "Enter the API key." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid input without sending anything", async () => {
    const result = await testConnection({ app: "radarr", url: "ftp://radarr.test", apiKey: KEY });

    expect(result).toEqual({ ok: false, message: "The address must start with http:// or https://." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an unauthorised key", () => new Response("no", { status: 401 }), "The API key was refused."],
    ["another HTTP error", () => new Response("no", { status: 500 }), "It answered with HTTP 500."],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed")), "Couldn't reach it. Check the address."],
    [
      "a timeout",
      () => Promise.reject(new DOMException("timed out", "TimeoutError")),
      "Timed out.",
    ],
    ["a reply that is not a status", () => json({ hello: "world" }), "That doesn't look like Radarr."],
  ])("maps %s to fixed text", async (_label, reply, message) => {
    fetchMock.mockImplementation(async () => reply());

    expect(await testConnection(input)).toEqual({ ok: false, message });
  });

  it("never puts the URL or the key in a failure message", async () => {
    fetchMock.mockResolvedValue(new Response("no", { status: 401 }));

    const result = await testConnection(input);

    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain("radarr.test");
  });
});

describe("saveConnectionSettings", () => {
  it("saves a passing connection, resets the clients and refreshes the layout", async () => {
    const result = await saveConnectionSettings({ app: "radarr", url: "http://radarr.test:7878/radarr/", apiKey: KEY });

    expect(result).toEqual({ ok: true, appName: "Radarr", version: "5.1.0" });
    expect(mocks.saveConnection).toHaveBeenCalledWith("radarr", {
      url: "http://radarr.test:7878/radarr",
      apiKey: KEY,
    });
    expect(mocks.resetArrClients).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("does not save when the test fails, and leaves the clients alone", async () => {
    fetchMock.mockResolvedValue(new Response("no", { status: 401 }));

    const result = await saveConnectionSettings(input);

    expect(result).toEqual({ ok: false, message: "The API key was refused." });
    expect(mocks.saveConnection).not.toHaveBeenCalled();
    expect(mocks.resetArrClients).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("saves with the stored key when the origin matches and no key is typed", async () => {
    mocks.getConnection.mockReturnValue({ url: "http://radarr.test:7878", apiKey: STORED_KEY });

    await saveConnectionSettings({ app: "radarr", url: "http://radarr.test:7878", apiKey: "" });

    expect(requestAt(0).headers.get("X-Api-Key")).toBe(STORED_KEY);
    expect(mocks.saveConnection).toHaveBeenCalledWith("radarr", { url: "http://radarr.test:7878", apiKey: STORED_KEY });
  });

  it("returns no stored key in any result", async () => {
    mocks.getConnection.mockReturnValue({ url: "http://radarr.test:7878", apiKey: STORED_KEY });

    const result = await saveConnectionSettings({ app: "radarr", url: "http://radarr.test:7878", apiKey: "" });

    expect(JSON.stringify(result)).not.toContain(STORED_KEY);
  });
});

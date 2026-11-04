import Database from "better-sqlite3";
import { join } from "node:path";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  revalidatePath: vi.fn(),
  createPin: vi.fn(),
  checkPin: vi.fn(),
  getPlexAccount: vi.fn(),
  getServerConnections: vi.fn(),
  authAppUrl: vi.fn(),
  getServerIdentity: vi.fn(),
  getLibrarySections: vi.fn(),
  rows: new Map<string, { value: string; expiresAt: Date }>(),
  testDb: { current: undefined as BetterSQLite3Database<typeof import("@/server/db/schema")> | undefined },
}));

vi.mock("@/server/authz", () => {
  class AuthzError extends Error {
    constructor(readonly status: 401 | 403) {
      super(status === 401 ? "unauthorized" : "forbidden");
      this.name = "AuthzError";
    }
  }
  return { AuthzError, requireRole: mocks.requireRole };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

// The verification table, as the actions use it: find (no consume), consume (delete and return), create.
vi.mock("@/server/auth", () => {
  const internalAdapter = {
    findVerificationValue: async (identifier: string) => {
      const row = mocks.rows.get(identifier);
      return row ? { identifier, ...row } : null;
    },
    consumeVerificationValue: async (identifier: string) => {
      const row = mocks.rows.get(identifier);
      mocks.rows.delete(identifier);
      return row ? { identifier, ...row } : null;
    },
    createVerificationValue: async ({ identifier, value, expiresAt }: { identifier: string; value: string; expiresAt: Date }) => {
      mocks.rows.set(identifier, { value, expiresAt });
      return { identifier, value, expiresAt };
    },
  };
  return { getAuth: () => ({ $context: Promise.resolve({ internalAdapter }) }) };
});

vi.mock("@/server/db", () => ({ db: () => mocks.testDb.current }));

vi.mock("@/server/plex/client", () => ({
  createPin: mocks.createPin,
  checkPin: mocks.checkPin,
  getPlexAccount: mocks.getPlexAccount,
  getServerConnections: mocks.getServerConnections,
  authAppUrl: mocks.authAppUrl,
}));

vi.mock("@/server/plex/server", () => ({
  getServerIdentity: mocks.getServerIdentity,
  getLibrarySections: mocks.getLibrarySections,
}));

import { AuthzError } from "@/server/authz";
import * as schema from "@/server/db/schema";
import { claimPlexAdminConfig, clearPlexAdminConfig } from "@/server/plex/admin-config";
import { getPlexDataClientId, getPlexDataConnection, getPlexDataSummary, savePlexDataConnection } from "@/server/plex/data-connection";
import { PlexRequestError } from "@/server/plex/errors";
import connectionsFixture from "@/server/plex/__fixtures__/server-connections.json";
import {
  checkPlexConnection,
  disconnectPlex,
  savePlexConnection,
  startPlexConnection,
  testPlexConnection,
} from "./plex-actions";

const DENIED = "You don't have permission to change connections.";
const TOKEN = "fake-plex-token-0123456789abcdef";
const SERVER_ID = "fakemachineid0123456789abcdef0123456789";
const OWNER_ID = 1000001;
const CONFIG = { serverId: SERVER_ID, serverName: "Fake Home Server", ownerAccountId: String(OWNER_ID) };
const CLIENT_ID_FOR_DATA = () => getPlexDataClientId();

const connections = connectionsFixture[0].connections;

function asAdmin(id = "admin-1") {
  mocks.requireRole.mockResolvedValue({ user: { id, email: "a@example.test", name: "A", role: "admin" } });
}

function asRequester() {
  mocks.requireRole.mockRejectedValue(new AuthzError(403));
}

function storedRow(identifier: string): unknown {
  const row = mocks.rows.get(identifier);
  return row ? JSON.parse(row.value) : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.clear();
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "..", "..", "drizzle") });
  mocks.testDb.current = instance;
  claimPlexAdminConfig(CONFIG);
  asAdmin();
  mocks.authAppUrl.mockReturnValue("https://app.plex.tv/auth#?fake");
  mocks.createPin.mockResolvedValue({ id: 42, code: "fake-code" });
  mocks.checkPin.mockResolvedValue(TOKEN);
  mocks.getPlexAccount.mockResolvedValue({ id: OWNER_ID, username: "fake-owner", email: null });
  mocks.getServerConnections.mockResolvedValue(connections);
  // Only the address that carries the stored server's id answers as that server.
  mocks.getServerIdentity.mockImplementation(async (conn: { url: string }) => {
    if (conn.url.startsWith("http://192.168.10.5")) return SERVER_ID;
    if (conn.url.includes("192-168-10-5")) return SERVER_ID;
    return "fakeotherserver";
  });
  mocks.getLibrarySections.mockResolvedValue([
    { key: "1", type: "movie", title: "Movies" },
    { key: "2", type: "show", title: "TV Shows" },
  ]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authorization", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["startPlexConnection", () => startPlexConnection()],
    ["checkPlexConnection", () => checkPlexConnection()],
    ["savePlexConnection", () => savePlexConnection({ optionId: "http-2" })],
    ["testPlexConnection", () => testPlexConnection()],
    ["disconnectPlex", () => disconnectPlex()],
  ];

  it.each(calls)("%s: a requester gets DENIED and nothing is called", async (_name, call) => {
    asRequester();
    expect(await call()).toEqual({ ok: false, message: DENIED });
    expect(mocks.createPin).not.toHaveBeenCalled();
    expect(mocks.checkPin).not.toHaveBeenCalled();
    expect(mocks.getServerIdentity).not.toHaveBeenCalled();
    expect(mocks.getLibrarySections).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(calls)("%s: checks the admin role first", async (_name, call) => {
    await call();
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });
});

describe("startPlexConnection", () => {
  it("creates a PIN as the data device and stores its id under the admin's user id", async () => {
    const result = await startPlexConnection();

    expect(result).toEqual({ ok: true, authUrl: "https://app.plex.tv/auth#?fake" });
    expect(mocks.createPin).toHaveBeenCalledWith({ clientId: CLIENT_ID_FOR_DATA() });
    expect(mocks.authAppUrl).toHaveBeenCalledWith({
      code: "fake-code",
      clientId: CLIENT_ID_FOR_DATA(),
      product: "MediaHub watched status",
    });
    expect(storedRow("plex-data-pin:admin-1")).toEqual({ pinId: 42 });
  });

  it("replaces an earlier PIN for the same admin", async () => {
    await startPlexConnection();
    mocks.createPin.mockResolvedValue({ id: 43, code: "fake-code-2" });
    await startPlexConnection();
    expect(storedRow("plex-data-pin:admin-1")).toEqual({ pinId: 43 });
    expect([...mocks.rows.keys()].filter((key) => key.startsWith("plex-data-pin:"))).toHaveLength(1);
  });

  it("asks for Plex setup first when no admin configuration is stored", async () => {
    clearPlexAdminConfig();
    expect(await startPlexConnection()).toEqual({ ok: false, message: "Finish Plex setup first." });
    expect(mocks.createPin).not.toHaveBeenCalled();
  });

  it("returns a fixed message when plex.tv fails, without the upstream text", async () => {
    mocks.createPin.mockRejectedValue(new PlexRequestError("Plex create PIN request failed: HTTP 503", "http", 503));
    expect(await startPlexConnection()).toEqual({ ok: false, message: "Couldn't reach Plex. Try again." });
    expect(console.error).toHaveBeenCalledWith("Plex create PIN request failed: HTTP 503");
  });
});

describe("checkPlexConnection", () => {
  async function started() {
    await startPlexConnection();
  }

  it("reports waiting and keeps the PIN row while the code isn't approved", async () => {
    await started();
    mocks.checkPin.mockResolvedValue(null);

    expect(await checkPlexConnection()).toEqual({ ok: true, status: "waiting" });
    expect(storedRow("plex-data-pin:admin-1")).toEqual({ pinId: 42 });
  });

  it("says to start again when there is no PIN row", async () => {
    expect(await checkPlexConnection()).toEqual({ ok: false, message: "Start again." });
    expect(mocks.checkPin).not.toHaveBeenCalled();
  });

  it("says to start again once the PIN row has expired", async () => {
    await started();
    const row = mocks.rows.get("plex-data-pin:admin-1")!;
    row.expiresAt = new Date(Date.now() - 1000);

    expect(await checkPlexConnection()).toEqual({ ok: false, message: "Start again." });
    expect(mocks.checkPin).not.toHaveBeenCalled();
  });

  it("refuses a token from an account that isn't the server owner, and consumes the PIN row", async () => {
    await started();
    mocks.getPlexAccount.mockResolvedValue({ id: 2002, username: "fake-friend", email: null });

    expect(await checkPlexConnection()).toEqual({ ok: false, message: "That Plex account isn't the server owner." });
    expect(mocks.rows.has("plex-data-pin:admin-1")).toBe(false);
    expect(mocks.rows.has("plex-data-pending:admin-1")).toBe(false);
  });

  it("says the server is missing when the account doesn't list it", async () => {
    await started();
    mocks.getServerConnections.mockResolvedValue(null);

    expect(await checkPlexConnection()).toEqual({
      ok: false,
      message: "Plex didn't list Fake Home Server for that account.",
    });
  });

  it("fails when no candidate address answers as the stored server", async () => {
    await started();
    mocks.getServerIdentity.mockResolvedValue("fakeotherserver");

    expect(await checkPlexConnection()).toEqual({
      ok: false,
      message: "MediaHub couldn't reach Fake Home Server on any of its addresses.",
    });
    expect(mocks.rows.has("plex-data-pending:admin-1")).toBe(false);
  });

  it("lists the passing addresses by label, with no token, URL or pin address in the reply", async () => {
    await started();

    const result = await checkPlexConnection();

    expect(result).toEqual({
      ok: true,
      status: "pick",
      options: [{ id: "pinned-0", label: "https · 192.168.10.5:32400" }],
    });
    const reply = JSON.stringify(result);
    expect(reply).not.toContain(TOKEN);
    expect(reply).not.toContain("http://");
    expect(reply).not.toContain("https://");
    expect(reply).not.toContain(".plex.direct");
    expect(reply).not.toContain("pinAddress");
  });

  it("keeps the token and the addresses in the server-side pending row", async () => {
    await started();
    await checkPlexConnection();

    const pending = storedRow("plex-data-pending:admin-1") as { token: string; candidates: { url: string }[] };
    expect(pending.token).toBe(TOKEN);
    expect(pending.candidates.map((c) => c.url)).toContain(
      "https://192-168-10-5.fakehash0123456789abcdef.plex.direct:32400",
    );
  });

  it("offers plain http, marked not encrypted, only when no https address answers", async () => {
    mocks.getServerIdentity.mockImplementation(async (conn: { url: string }) =>
      conn.url.startsWith("http://192.168.10.5") ? SERVER_ID : "fakeotherserver",
    );
    await started();

    expect(await checkPlexConnection()).toEqual({
      ok: true,
      status: "pick",
      options: [{ id: "http-2", label: "http · 192.168.10.5:32400 (not encrypted)" }],
    });
  });

  it("checks the token with the data client id", async () => {
    await started();
    await checkPlexConnection();
    expect(mocks.checkPin).toHaveBeenCalledWith(42, { clientId: CLIENT_ID_FOR_DATA() });
    expect(mocks.getPlexAccount).toHaveBeenCalledWith(TOKEN, { clientId: CLIENT_ID_FOR_DATA() });
  });

  it("is one-shot: a second check after approval says to start again", async () => {
    await started();
    await checkPlexConnection();
    expect(await checkPlexConnection()).toEqual({ ok: false, message: "Start again." });
  });
});

describe("savePlexConnection", () => {
  async function picked() {
    await startPlexConnection();
    await checkPlexConnection();
  }

  /** As picked(), but only plain http answers, so the pick list holds http-2. */
  async function pickedHttp() {
    mocks.getServerIdentity.mockImplementation(async (conn: { url: string }) =>
      conn.url.startsWith("http://192.168.10.5") ? SERVER_ID : "fakeotherserver",
    );
    await picked();
  }

  it("rejects an unknown option and saves nothing", async () => {
    await picked();

    expect(await savePlexConnection({ optionId: "fake-unknown" })).toEqual({
      ok: false,
      message: "Choose an address from the list.",
    });
    expect(getPlexDataConnection()).toBeNull();
  });

  it("rejects input with extra fields, such as a URL from the browser", async () => {
    await picked();

    expect(await savePlexConnection({ optionId: "http-2", url: "http://evil.test:32400" })).toEqual({
      ok: false,
      message: "Choose an address from the list.",
    });
    expect(getPlexDataConnection()).toBeNull();
  });

  it("saves the address from the pending row, with its token", async () => {
    await pickedHttp();

    const result = await savePlexConnection({ optionId: "http-2" });

    expect(result).toEqual({ ok: true, label: "http · 192.168.10.5:32400 (not encrypted)", sections: 2 });
    expect(getPlexDataConnection()).toEqual({ url: "http://192.168.10.5:32400", pinAddress: null, token: TOKEN });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/connections");
    expect(mocks.rows.has("plex-data-pending:admin-1")).toBe(false);
  });

  it("saves the pinned address and its pin for an https choice", async () => {
    await picked();

    await savePlexConnection({ optionId: "pinned-0" });

    expect(getPlexDataConnection()).toEqual({
      url: "https://192-168-10-5.fakehash0123456789abcdef.plex.direct:32400",
      pinAddress: "192.168.10.5",
      token: TOKEN,
    });
  });

  it("refuses to save when the address no longer answers as the stored server", async () => {
    await picked();
    mocks.getServerIdentity.mockResolvedValue("fakeotherserver");

    expect(await savePlexConnection({ optionId: "pinned-0" })).toEqual({
      ok: false,
      message: "That address now answers as a different Plex server. Connect again.",
    });
    expect(getPlexDataConnection()).toBeNull();
  });

  it("is single-use: the pending row is gone after one save attempt, even a failed one", async () => {
    await picked();
    mocks.getServerIdentity.mockResolvedValue("fakeotherserver");
    await savePlexConnection({ optionId: "pinned-0" });

    expect(mocks.rows.has("plex-data-pending:admin-1")).toBe(false);
    expect(await savePlexConnection({ optionId: "pinned-0" })).toEqual({ ok: false, message: "Start again." });
  });

  it("refuses a pending token checked against a different Plex setup", async () => {
    await picked();
    const row = mocks.rows.get("plex-data-pending:admin-1")!;
    const value = JSON.parse(row.value) as Record<string, unknown>;
    mocks.rows.set("plex-data-pending:admin-1", { ...row, value: JSON.stringify({ ...value, ownerAccountId: "999" }) });

    expect(await savePlexConnection({ optionId: "pinned-0" })).toEqual({ ok: false, message: "Start again." });
    expect(getPlexDataConnection()).toBeNull();
  });

  it("says to start again when the pending row has gone", async () => {
    expect(await savePlexConnection({ optionId: "http-2" })).toEqual({ ok: false, message: "Start again." });
  });
});

describe("testPlexConnection", () => {
  it("lists the section titles once the stored server answers", async () => {
    savePlexDataConnection({ url: "http://192.168.10.5:32400", pinAddress: null, token: TOKEN });

    expect(await testPlexConnection()).toEqual({ ok: true, sections: ["Movies", "TV Shows"] });
    expect(mocks.getLibrarySections).toHaveBeenCalledWith(
      { url: "http://192.168.10.5:32400", pinAddress: null },
      TOKEN,
    );
  });

  it("says the token was refused on a 401, and the message holds no upstream text", async () => {
    savePlexDataConnection({ url: "http://192.168.10.5:32400", pinAddress: null, token: TOKEN });
    mocks.getLibrarySections.mockRejectedValue(new PlexRequestError("Plex library sections request failed: HTTP 401", "http", 401));

    const result = await testPlexConnection();
    expect(result).toEqual({ ok: false, message: "Plex refused the stored token. Connect again." });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("asks to connect first when nothing is stored", async () => {
    expect(await testPlexConnection()).toEqual({ ok: false, message: "Connect Plex first." });
  });

  it("refuses when the stored address now answers as a different server", async () => {
    savePlexDataConnection({ url: "http://192.168.10.5:32400", pinAddress: null, token: TOKEN });
    mocks.getServerIdentity.mockResolvedValue("fakeotherserver");

    expect(await testPlexConnection()).toEqual({
      ok: false,
      message: "That address now answers as a different Plex server. Connect again.",
    });
    expect(mocks.getLibrarySections).not.toHaveBeenCalled();
  });
});

describe("disconnectPlex", () => {
  it("clears the stored connection and revalidates the page", async () => {
    savePlexDataConnection({ url: "http://192.168.10.5:32400", pinAddress: null, token: TOKEN });

    expect(await disconnectPlex()).toEqual({ ok: true });
    expect(getPlexDataConnection()).toBeNull();
    expect(getPlexDataSummary()).toEqual({ connected: false, url: null });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/connections");
  });
});

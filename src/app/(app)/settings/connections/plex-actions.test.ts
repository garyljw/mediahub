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
  getVisibleServers: vi.fn(),
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
  getVisibleServers: mocks.getVisibleServers,
  authAppUrl: mocks.authAppUrl,
}));

vi.mock("@/server/plex/server", () => ({
  getServerIdentity: mocks.getServerIdentity,
  getLibrarySections: mocks.getLibrarySections,
}));

import { AuthzError } from "@/server/authz";
import * as schema from "@/server/db/schema";
import { claimPlexAdminConfig, clearPlexAdminConfig } from "@/server/plex/admin-config";
import type { PlexConnection, VisibleServer } from "@/server/plex/client";
import {
  getPlexDataClientId,
  getPlexDataConnection,
  getPlexDataSummary,
  savePlexDataConnection,
} from "@/server/plex/data-connection";
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
const OWNER_ID = 1000001;
const HOME = {
  id: "fakemachineid0123456789abcdef0123456789",
  name: "Fake Home Server",
  token: "fake-home-access-token-0123456789abcdef",
};
const FRIEND = {
  id: "fakefriendmachine0123456789abcdef0123",
  name: "Fake Friend Server",
  token: "fake-friend-access-token-0123456789abcd",
};
const CONFIG = { serverId: HOME.id, serverName: HOME.name, ownerAccountId: String(OWNER_ID) };

type RawResource = {
  name: string;
  provides: string;
  owned?: boolean;
  clientIdentifier: string;
  accessToken?: string;
  connections: PlexConnection[];
};

/** The fixture as getVisibleServers returns it: servers with an access token, owned or shared. */
function visibleServers(): VisibleServer[] {
  return (connectionsFixture as RawResource[])
    .filter((resource) => resource.provides === "server" && resource.accessToken)
    .map((resource) => ({
      clientIdentifier: resource.clientIdentifier,
      name: resource.name,
      owned: resource.owned === true,
      accessToken: resource.accessToken!,
      connections: resource.connections,
    }));
}

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

/** Which fake server an address answers as. The Friend's pinned https address does not answer. */
function identityOf(conn: { url: string }): string {
  if (conn.url.includes("192-168-10-5") || conn.url.startsWith("http://192.168.10.5")) return HOME.id;
  if (conn.url.startsWith("http://198.51.100.20")) return FRIEND.id;
  return "fakeotherserver";
}

/** Stores the Friend's plain http address as the Plex data connection. */
function storeFriendConnection() {
  savePlexDataConnection({
    url: "http://198.51.100.20:32400",
    pinAddress: null,
    token: FRIEND.token,
    serverId: FRIEND.id,
    serverName: FRIEND.name,
  });
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
  // Both fixture servers are treated as owned here; the shared case has its own test below.
  mocks.getVisibleServers.mockResolvedValue(visibleServers().map((server) => ({ ...server, owned: true })));
  // Each server's addresses answer only as that server. The Home pinned https address works; the Friend's pinned
  // address does not, so only its plain http address passes.
  mocks.getServerIdentity.mockImplementation(async (conn: { url: string }) => identityOf(conn));
  mocks.getLibrarySections.mockResolvedValue([
    { key: "1", type: "movie", title: "Movies" },
    { key: "2", type: "show", title: "TV Shows" },
  ]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FRIEND_HTTP = { id: "1-http-1", label: "Fake Friend Server · http · 198.51.100.20:32400 (not encrypted)" };
const HOME_PINNED = { id: "0-pinned-0", label: "Fake Home Server · https · 192.168.10.5:32400" };

describe("authorization", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["startPlexConnection", () => startPlexConnection()],
    ["checkPlexConnection", () => checkPlexConnection()],
    ["savePlexConnection", () => savePlexConnection({ optionId: "0-pinned-0" })],
    ["testPlexConnection", () => testPlexConnection()],
    ["disconnectPlex", () => disconnectPlex()],
  ];

  it.each(calls)("%s: checks the admin role first, then a requester gets DENIED and nothing is called", async (_name, call) => {
    asRequester();
    expect(await call()).toEqual({ ok: false, message: DENIED });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
    expect(mocks.createPin).not.toHaveBeenCalled();
    expect(mocks.checkPin).not.toHaveBeenCalled();
    expect(mocks.getServerIdentity).not.toHaveBeenCalled();
    expect(mocks.getLibrarySections).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(calls)("%s: rethrows an error that is not an AuthzError", async (_name, call) => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));
    await expect(call()).rejects.toThrow("database down");
    expect(mocks.createPin).not.toHaveBeenCalled();
  });
});

describe("startPlexConnection", () => {
  it("creates a PIN as the data device and stores its id under the admin's user id", async () => {
    const result = await startPlexConnection();

    expect(result).toEqual({ ok: true, authUrl: "https://app.plex.tv/auth#?fake" });
    expect(mocks.createPin).toHaveBeenCalledWith({ clientId: getPlexDataClientId(), product: "MediaHub watched status" });
    expect(mocks.authAppUrl).toHaveBeenCalledWith({
      code: "fake-code",
      clientId: getPlexDataClientId(),
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
    mocks.rows.get("plex-data-pin:admin-1")!.expiresAt = new Date(Date.now() - 1000);

    expect(await checkPlexConnection()).toEqual({ ok: false, message: "Start again." });
    expect(mocks.checkPin).not.toHaveBeenCalled();
  });

  it("refuses a token from an account that isn't the server owner, and consumes the PIN row", async () => {
    await started();
    mocks.getPlexAccount.mockResolvedValue({ id: 2002, username: "fake-friend", email: null });

    expect(await checkPlexConnection()).toEqual({ ok: false, message: "That Plex account isn't the server owner." });
    expect(mocks.rows.has("plex-data-pin:admin-1")).toBe(false);
    expect(mocks.rows.has("plex-data-pending:admin-1")).toBe(false);
    expect(mocks.getVisibleServers).not.toHaveBeenCalled();
  });

  it("says no server is reachable when the account lists none", async () => {
    await started();
    mocks.getVisibleServers.mockResolvedValue([]);

    expect(await checkPlexConnection()).toEqual({
      ok: false,
      message: "MediaHub couldn't reach any of your Plex servers.",
    });
    expect(mocks.rows.has("plex-data-pending:admin-1")).toBe(false);
  });

  it("fails when no address of any server answers as that server", async () => {
    await started();
    mocks.getServerIdentity.mockResolvedValue("fakeotherserver");

    expect(await checkPlexConnection()).toEqual({
      ok: false,
      message: "MediaHub couldn't reach any of your Plex servers.",
    });
    expect(mocks.rows.has("plex-data-pending:admin-1")).toBe(false);
  });

  it("lists every reachable owned server by name, with no token, URL or pin address in the reply", async () => {
    await started();

    const result = await checkPlexConnection();

    expect(result).toEqual({ ok: true, status: "pick", options: [FRIEND_HTTP, HOME_PINNED] });
    const reply = JSON.stringify(result);
    expect(reply).not.toContain(TOKEN);
    expect(reply).not.toContain(HOME.token);
    expect(reply).not.toContain(FRIEND.token);
    expect(reply).not.toContain("http://");
    expect(reply).not.toContain("https://");
    expect(reply).not.toContain(".plex.direct");
    expect(reply).not.toContain("pinAddress");
  });

  it("never lists or probes a server the account doesn't own", async () => {
    mocks.getVisibleServers.mockResolvedValue(visibleServers());
    await started();

    expect(await checkPlexConnection()).toEqual({ ok: true, status: "pick", options: [HOME_PINNED] });
    const probed = mocks.getServerIdentity.mock.calls.map(([conn]) => (conn as { url: string }).url);
    expect(probed.some((url) => url.includes("198.51.100.20"))).toBe(false);
  });

  it("still lists the other servers when one server's check fails unexpectedly", async () => {
    mocks.getServerIdentity.mockImplementation(async (conn: { url: string }) => {
      if (conn.url.startsWith("http://198.51.100.20")) throw new Error("fake unexpected failure");
      return identityOf(conn);
    });
    await started();

    expect(await checkPlexConnection()).toEqual({ ok: true, status: "pick", options: [HOME_PINNED] });
  });

  it("offers plain http for a server only when none of its pinned https addresses works", async () => {
    await started();
    await checkPlexConnection();

    // Home's pinned address works, so its plain http address is not offered; Friend has no working pinned address.
    const pending = storedRow("plex-data-pending:admin-1") as { candidates: { id: string }[] };
    expect(pending.candidates.map((c) => c.id)).toEqual(["1-http-1", "0-pinned-0"]);
  });

  it("stores each candidate's own server id, name and access token, and the owner id, server-side", async () => {
    await started();
    await checkPlexConnection();

    const pending = storedRow("plex-data-pending:admin-1") as {
      ownerAccountId: string;
      candidates: { id: string; serverId: string; serverName: string; token: string }[];
    };
    expect(pending.ownerAccountId).toBe(String(OWNER_ID));
    expect(pending.candidates).toEqual([
      expect.objectContaining({ id: "1-http-1", serverId: FRIEND.id, serverName: FRIEND.name, token: FRIEND.token }),
      expect.objectContaining({ id: "0-pinned-0", serverId: HOME.id, serverName: HOME.name, token: HOME.token }),
    ]);
  });

  it("checks the token with the data client id", async () => {
    await started();
    await checkPlexConnection();
    const caller = { clientId: getPlexDataClientId(), product: "MediaHub watched status" };
    expect(mocks.checkPin).toHaveBeenCalledWith(42, caller);
    expect(mocks.getPlexAccount).toHaveBeenCalledWith(TOKEN, caller);
    expect(mocks.getVisibleServers).toHaveBeenCalledWith(TOKEN, caller);
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

    expect(await savePlexConnection({ optionId: "1-http-1", url: "http://evil.test:32400" })).toEqual({
      ok: false,
      message: "Choose an address from the list.",
    });
    expect(getPlexDataConnection()).toBeNull();
  });

  it("saves the second server's address with that server's own token and id", async () => {
    await picked();

    const result = await savePlexConnection({ optionId: "1-http-1" });

    expect(result).toEqual({ ok: true, label: FRIEND_HTTP.label, sections: 2 });
    expect(getPlexDataConnection()).toEqual({
      url: "http://198.51.100.20:32400",
      pinAddress: null,
      token: FRIEND.token,
      serverId: FRIEND.id,
      serverName: FRIEND.name,
    });
    expect(mocks.getLibrarySections).toHaveBeenCalledWith({ url: "http://198.51.100.20:32400", pinAddress: null }, FRIEND.token);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/connections");
    expect(mocks.rows.has("plex-data-pending:admin-1")).toBe(false);
  });

  it("saves an owned server's pinned address with its pin and its own token, not the PIN token", async () => {
    await picked();

    await savePlexConnection({ optionId: "0-pinned-0" });

    expect(getPlexDataConnection()).toEqual({
      url: "https://192-168-10-5.fakehash0123456789abcdef.plex.direct:32400",
      pinAddress: "192.168.10.5",
      token: HOME.token,
      serverId: HOME.id,
      serverName: HOME.name,
    });
  });

  it("checks the chosen server's identity, and refuses when the address answers as another server", async () => {
    await picked();
    // The Friend's address now answers as Home.
    mocks.getServerIdentity.mockResolvedValue(HOME.id);

    expect(await savePlexConnection({ optionId: "1-http-1" })).toEqual({
      ok: false,
      message: "That address now answers as a different Plex server. Connect again.",
    });
    expect(getPlexDataConnection()).toBeNull();
  });

  it("is single-use: the pending row is gone after one save attempt, even a failed one", async () => {
    await picked();
    mocks.getServerIdentity.mockResolvedValue("fakeotherserver");
    await savePlexConnection({ optionId: "0-pinned-0" });

    expect(mocks.rows.has("plex-data-pending:admin-1")).toBe(false);
    expect(await savePlexConnection({ optionId: "0-pinned-0" })).toEqual({ ok: false, message: "Start again." });
  });

  it("refuses a pending row for a different owner account", async () => {
    await picked();
    const row = mocks.rows.get("plex-data-pending:admin-1")!;
    const value = JSON.parse(row.value) as Record<string, unknown>;
    mocks.rows.set("plex-data-pending:admin-1", { ...row, value: JSON.stringify({ ...value, ownerAccountId: "999" }) });

    expect(await savePlexConnection({ optionId: "0-pinned-0" })).toEqual({ ok: false, message: "Start again." });
    expect(getPlexDataConnection()).toBeNull();
  });

  it("says to start again when the pending row has gone", async () => {
    expect(await savePlexConnection({ optionId: "1-http-1" })).toEqual({ ok: false, message: "Start again." });
  });
});

describe("testPlexConnection", () => {
  it("lists the section titles once the chosen server answers as itself", async () => {
    storeFriendConnection();
    mocks.getServerIdentity.mockResolvedValue(FRIEND.id);

    expect(await testPlexConnection()).toEqual({ ok: true, sections: ["Movies", "TV Shows"] });
    expect(mocks.getLibrarySections).toHaveBeenCalledWith({ url: "http://198.51.100.20:32400", pinAddress: null }, FRIEND.token);
  });

  it("refuses when the stored address now answers as a different server", async () => {
    storeFriendConnection();
    mocks.getServerIdentity.mockResolvedValue(HOME.id);

    expect(await testPlexConnection()).toEqual({
      ok: false,
      message: "That address now answers as a different Plex server. Connect again.",
    });
    expect(mocks.getLibrarySections).not.toHaveBeenCalled();
  });

  it("says the token was refused on a 401, and the message holds no upstream text", async () => {
    storeFriendConnection();
    mocks.getServerIdentity.mockResolvedValue(FRIEND.id);
    mocks.getLibrarySections.mockRejectedValue(new PlexRequestError("Plex library sections request failed: HTTP 401", "http", 401));

    const result = await testPlexConnection();
    expect(result).toEqual({ ok: false, message: "Plex refused the stored token. Connect again." });
    expect(JSON.stringify(result)).not.toContain(FRIEND.token);
  });

  it("asks to connect first when nothing is stored", async () => {
    expect(await testPlexConnection()).toEqual({ ok: false, message: "Connect Plex first." });
  });
});

describe("disconnectPlex", () => {
  it("clears the stored connection and revalidates the page; the summary never holds the token", async () => {
    storeFriendConnection();
    expect(getPlexDataSummary()).toEqual({ connected: true, url: "http://198.51.100.20:32400", serverName: FRIEND.name });
    expect(JSON.stringify(getPlexDataSummary())).not.toContain(FRIEND.token);

    expect(await disconnectPlex()).toEqual({ ok: true });
    expect(getPlexDataConnection()).toBeNull();
    expect(getPlexDataSummary()).toEqual({ connected: false, url: null, serverName: null });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/connections");
  });
});

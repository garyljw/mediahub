import "server-only";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";

// A real Better Auth instance on an in-memory database, with the Plex network calls mocked. The
// plugin's endpoints are reached through auth.handler, the same way the Next route reaches them.

const ORIGIN = "https://mediahub.example.test";
const SERVER_ID = "fake-server-id-1";
const OWNER = { id: 1001, username: "fake-owner", email: "owner@example.test" };

const testDb = vi.hoisted(() => ({ current: undefined as BetterSQLite3Database<typeof schema> | undefined }));

vi.mock("@/server/db", () => ({ db: () => testDb.current }));
vi.mock("@/server/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://mediahub.example.test" }) }));

// Only the admin-config getter is wrapped, so one test can simulate a racing setup.
vi.mock("./admin-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./admin-config")>();
  return { ...actual, getPlexAdminConfig: vi.fn(actual.getPlexAdminConfig) };
});

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    createPin: vi.fn(),
    checkPin: vi.fn(),
    getPlexAccount: vi.fn(),
    getOwnedServers: vi.fn(),
  };
});

import { claimPlexAdminConfig, getPlexAdminConfig } from "./admin-config";
import { createPin, checkPin, getOwnedServers, getPlexAccount, PlexRequestError } from "./client";
import { getPlexClientId, resetPlexClientIdCache } from "./client-id";
import { plexAuth } from "./auth-plugin";

const CONFIG = { serverId: SERVER_ID, serverName: "Fake Server", ownerAccountId: String(OWNER.id) };

function buildAuth() {
  return betterAuth({
    baseURL: ORIGIN,
    secret: "fake-test-secret-0123456789abcdefghijklmn",
    // Better Auth turns the origin and CSRF checks off under NODE_ENV=test. Turn them back on so the
    // tests run the same checks production does.
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    database: drizzleAdapter(testDb.current!, {
      provider: "sqlite",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true },
    user: {
      additionalFields: {
        role: { type: ["admin", "requester"], required: false, defaultValue: "requester", input: false },
      },
    },
    plugins: [plexAuth({ wait: async () => {} })],
  });
}

type Auth = ReturnType<typeof buildAuth>;
let auth: Auth;

beforeEach(() => {
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  testDb.current = instance;
  resetPlexClientIdCache();
  auth = buildAuth();
  vi.mocked(createPin).mockReset();
  vi.mocked(checkPin).mockReset();
  vi.mocked(getPlexAccount).mockReset();
  vi.mocked(getOwnedServers).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type SendOptions = { method?: "GET" | "POST"; cookie?: string; origin?: string | null; json?: unknown };

function send(path: string, options: SendOptions = {}): Promise<Response> {
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.json !== undefined) headers.set("content-type", "application/json");
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: options.method ?? "POST",
      headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
      redirect: "manual",
    }),
  );
}

/** The value of a Set-Cookie for `name`, or undefined. An empty value means the cookie was cleared. */
function setCookieValue(response: Response, name: string): string | undefined {
  for (const line of response.headers.getSetCookie()) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).split(";")[0];
  }
  return undefined;
}

function hasSessionCookie(response: Response): boolean {
  return response.headers.getSetCookie().some((line) => /(^|__Secure-)better-auth\.session_token=[^;]+/.test(line));
}

/** True when the response clears the named cookie (an empty value with Max-Age=0). */
function clearsCookie(response: Response, name: string): boolean {
  return response.headers.getSetCookie().some((line) => line.startsWith(`${name}=;`) && /Max-Age=0/i.test(line));
}

const location = (response: Response) => response.headers.get("location");

/** The role is an additional field, so the inferred User type doesn't have it. */
const roleOf = (user: object | null | undefined) => (user && "role" in user ? user.role : undefined);

/** Starts a PIN flow and returns the state cookie value. */
async function startFlow(): Promise<string> {
  vi.mocked(createPin).mockResolvedValue({ id: 77, code: "FAKECODE" });
  const response = await send("/plex/start");
  const state = setCookieValue(response, "mediahub_plex_pin");
  if (!state) throw new Error("start did not set the state cookie");
  return state;
}

/** Plex approved the PIN and the account and servers are the given ones. */
function approve(account = OWNER, servers = [{ clientIdentifier: SERVER_ID, name: "Fake Server" }]) {
  vi.mocked(checkPin).mockResolvedValue("FAKE-TOKEN-123");
  vi.mocked(getPlexAccount).mockResolvedValue(account);
  vi.mocked(getOwnedServers).mockResolvedValue(servers);
}

function callback(state: string | undefined) {
  return send("/plex/callback", { method: "GET", cookie: state ? `mediahub_plex_pin=${state}` : undefined });
}

/** Runs the callback for a fresh PIN flow, from start to callback. */
async function signInWithPlex(account = OWNER, servers?: { clientIdentifier: string; name: string }[]) {
  const state = await startFlow();
  approve(account, servers);
  return callback(state);
}

async function setupStateCookie(): Promise<string> {
  const response = await signInWithPlex();
  const cookie = setCookieValue(response, "mediahub_plex_setup");
  if (!cookie) throw new Error("callback did not store the setup state");
  return cookie;
}

function setupComplete(setupCookie: string | undefined, serverId: string) {
  return send("/plex/setup/complete", {
    cookie: setupCookie ? `mediahub_plex_setup=${setupCookie}` : undefined,
    json: { serverId },
  });
}

async function createUserWithPassword(email: string, role: "admin" | "requester", password = "fake-password-long-enough"): Promise<string> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { email, name: email.split("@")[0] ?? "user", role, emailVerified: true } as Parameters<typeof ctx.internalAdapter.createUser>[0],
    { method: "email-password" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(password),
  });
  return user.id;
}

async function createPlexUser(accountId: string, role: "admin" | "requester", email: string): Promise<string> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { email, name: "plex user", role, emailVerified: false } as Parameters<typeof ctx.internalAdapter.createUser>[0],
    { method: "plex" },
  );
  await ctx.internalAdapter.createAccount({ userId: user.id, providerId: "plex", accountId });
  return user.id;
}

describe("POST /plex/start", () => {
  it("accepts the request the sign-in button sends: an empty JSON body", async () => {
    vi.mocked(createPin).mockResolvedValue({ id: 77, code: "FAKECODE" });
    const response = await send("/plex/start", { json: {} });
    expect(response.status).toBe(200);
  });

  it("answers 415 to a POST with a body but no JSON content type, as Next delivers a bodiless fetch", async () => {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/plex/start`, { method: "POST", headers: { origin: ORIGIN }, body: "" }),
    );
    expect(response.status).toBe(415);
  });

  it("stores the PIN under a random state, sets the state cookie, and returns the plex.tv address", async () => {
    vi.mocked(createPin).mockResolvedValue({ id: 77, code: "FAKECODE" });
    const response = await send("/plex/start");

    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((line) => line.startsWith("mediahub_plex_pin="));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).toMatch(/Secure/);

    const state = setCookieValue(response, "mediahub_plex_pin")!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await (await auth.$context).internalAdapter.findVerificationValue(`plex-pin:${state}`);
    // The PIN row holds the PIN id and nothing else: no client id, no key, no token.
    expect(JSON.parse(stored!.value)).toEqual({ pinId: 77 });

    const body = (await response.json()) as { url: string };
    const url = new URL(body.url);
    expect(url.origin + url.pathname).toBe("https://app.plex.tv/auth");
    expect(url.hash).toContain("code=FAKECODE");
    expect(url.hash).toContain(`clientID=${getPlexClientId()}`);
    expect(url.hash).toContain(encodeURIComponent(`${ORIGIN}/api/auth/plex/callback`));
  });

  it("refuses a POST from another origin when the request carries a cookie", async () => {
    vi.mocked(createPin).mockResolvedValue({ id: 1, code: "X" });
    const response = await send("/plex/start", { cookie: "unrelated=1", origin: "https://evil.example.test" });
    expect(response.status).toBe(403);
    expect(createPin).not.toHaveBeenCalled();
  });
});

/** The clientID the sign-in address was built with. */
function clientIdFromUrl(body: { url: string }): string {
  return new URL(body.url).hash.split("clientID=")[1]!.split("&")[0]!;
}

describe("one fixed client id per install", () => {
  const storedClientIdRows = () =>
    testDb.current!.select().from(schema.setting).all().filter((row) => row.key === "plex.signInClientId");
  const settingKeys = () => testDb.current!.select().from(schema.setting).all().map((row) => row.key);

  it("uses the same client id for every /plex/start, and the address carries the stored one", async () => {
    vi.mocked(createPin).mockResolvedValue({ id: 77, code: "FAKECODE" });
    const first = await send("/plex/start");
    const second = await send("/plex/start");
    const firstId = clientIdFromUrl((await first.json()) as { url: string });
    const secondId = clientIdFromUrl((await second.json()) as { url: string });
    expect(firstId).toMatch(/^mediahub-/);
    expect(secondId).toBe(firstId);
    expect(storedClientIdRows()).toHaveLength(1);
    expect(storedClientIdRows()[0]!.value).toBe(firstId);
  });

  it("the callback checks the PIN by id only, and uses the token for the account and the servers", async () => {
    vi.mocked(createPin).mockResolvedValue({ id: 77, code: "FAKECODE" });
    const started = await send("/plex/start");
    approve();
    await callback(setCookieValue(started, "mediahub_plex_pin"));

    expect(vi.mocked(checkPin).mock.calls[0]).toEqual([77]);
    expect(vi.mocked(getPlexAccount).mock.calls[0]).toEqual(["FAKE-TOKEN-123"]);
    expect(vi.mocked(getOwnedServers).mock.calls[0]).toEqual(["FAKE-TOKEN-123"]);
  });

  it("consumes the PIN row in the callback, so the PIN id is gone after it", async () => {
    const state = await startFlow();
    approve();
    await callback(state);
    expect(await (await auth.$context).internalAdapter.findVerificationValue(`plex-pin:${state}`)).toBeNull();
  });

  it("treats a PIN row with no pin id as expired, without asking plex.tv", async () => {
    const ctx = await auth.$context;
    await ctx.internalAdapter.createVerificationValue({
      identifier: "plex-pin:fake-state-value",
      value: JSON.stringify({ clientId: "mediahub-fake-client", privateKeyPem: "fake-old-row" }),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = await callback("fake-state-value");
    expect(location(response)).toBe(`${ORIGIN}/login?plex=expired`);
    expect(checkPin).not.toHaveBeenCalled();
  });

  it("writes only the client id setting during sign-in, and never the old device rows", async () => {
    // Sign-in writes one setting row: the fixed client id. Nothing else.
    const response = await signInWithPlex();
    expect(settingKeys()).toEqual(["plex.signInClientId"]);

    // Setup adds the admin config, but still never the old device rows.
    await setupComplete(setCookieValue(response, "mediahub_plex_setup"), SERVER_ID);
    expect(settingKeys()).toContain("plex.signInClientId");
    expect(settingKeys()).not.toContain("plex.clientId");
    expect(settingKeys()).not.toContain("plex.devicePrivateKey");
  });
});

describe("GET /plex/callback, admin sign-in (configured)", () => {
  beforeEach(async () => {
    claimPlexAdminConfig(CONFIG);
    const ctx = await auth.$context;
    const adminId = await createPlexUser(String(OWNER.id), "admin", "owner@example.test");
    expect(adminId).toBeTruthy();
    expect(ctx).toBeTruthy();
  });

  it("signs in the owner and redirects to /", async () => {
    const response = await signInWithPlex();
    expect(response.status).toBe(302);
    expect(location(response)).toBe(`${ORIGIN}/`);
    expect(hasSessionCookie(response)).toBe(true);
  });

  it("denies a different Plex account even if it owns the server", async () => {
    const response = await signInWithPlex({ ...OWNER, id: 4242 });
    expect(location(response)).toBe(`${ORIGIN}/login?plex=denied`);
    expect(hasSessionCookie(response)).toBe(false);
  });

  it("denies the owner when the configured server is not in their owned servers", async () => {
    const response = await signInWithPlex(OWNER, [{ clientIdentifier: "fake-other-server", name: "Other" }]);
    expect(location(response)).toBe(`${ORIGIN}/login?plex=denied`);
    expect(hasSessionCookie(response)).toBe(false);
  });

  it("denies a linked Plex account whose user is not an admin", async () => {
    // Replace the admin set up in beforeEach with a requester linked to the same Plex account.
    const ctx = await auth.$context;
    const admin = await ctx.internalAdapter.findUserByEmail("owner@example.test");
    await ctx.internalAdapter.deleteUser(admin!.user.id);
    await createPlexUser(String(OWNER.id), "requester", "req@example.test");
    const response = await signInWithPlex();
    expect(location(response)).toBe(`${ORIGIN}/login?plex=denied`);
    expect(hasSessionCookie(response)).toBe(false);
  });

  it("expires when the state cookie is missing", async () => {
    approve();
    const response = await callback(undefined);
    expect(location(response)).toBe(`${ORIGIN}/login?plex=expired`);
  });

  it("expires on a replayed state: the second use of the same state fails", async () => {
    const state = await startFlow();
    approve();
    const first = await callback(state);
    expect(hasSessionCookie(first)).toBe(true);
    const second = await callback(state);
    expect(location(second)).toBe(`${ORIGIN}/login?plex=expired`);
    expect(hasSessionCookie(second)).toBe(false);
    expect(clearsCookie(second, "mediahub_plex_pin")).toBe(true);
  });

  it("reports not-approved after the retries run out, with four PIN checks in all", async () => {
    const state = await startFlow();
    vi.mocked(checkPin).mockResolvedValue(null);
    const response = await callback(state);
    expect(location(response)).toBe(`${ORIGIN}/login?plex=not-approved`);
    expect(checkPin).toHaveBeenCalledTimes(4);
  });

  it("reports error for a PlexRequestError, and the token never reaches logs or responses", async () => {
    const logs: string[] = [];
    for (const method of ["log", "warn", "error", "info", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }
    const state = await startFlow();
    vi.mocked(checkPin).mockResolvedValue("FAKE-TOKEN-123");
    vi.mocked(getPlexAccount).mockRejectedValue(new PlexRequestError("Plex account request failed: HTTP 500", "http", 500));

    const response = await callback(state);
    expect(location(response)).toBe(`${ORIGIN}/login?plex=error`);
    const body = await response.text();
    const headerText = JSON.stringify([...response.headers.entries()]);
    expect(body + headerText).not.toContain("FAKE-TOKEN-123");
    expect(logs.join("\n")).not.toContain("FAKE-TOKEN-123");
    expect(logs.join("\n")).toContain("Plex account request failed: HTTP 500");
  });
});

describe("GET /plex/callback, setup (not configured)", () => {
  it("stores the pending setup and redirects to /setup/server", async () => {
    const response = await signInWithPlex();
    expect(location(response)).toBe(`${ORIGIN}/setup/server`);
    expect(hasSessionCookie(response)).toBe(false);
    const setupState = setCookieValue(response, "mediahub_plex_setup")!;
    const stored = await (await auth.$context).internalAdapter.findVerificationValue(`plex-setup:${setupState}`);
    const pending = JSON.parse(stored!.value) as { accountId: string; servers: unknown[]; email: string };
    expect(pending.accountId).toBe(String(OWNER.id));
    expect(pending.email).toBe(OWNER.email);
    expect(pending.servers).toEqual([{ clientIdentifier: SERVER_ID, name: "Fake Server" }]);
  });

  it("redirects to /setup?plex=no-servers when the account owns no server", async () => {
    const response = await signInWithPlex(OWNER, []);
    expect(location(response)).toBe(`${ORIGIN}/setup?plex=no-servers`);
  });

  it("redirects to /setup?plex=error on a PlexRequestError", async () => {
    const state = await startFlow();
    vi.mocked(checkPin).mockResolvedValue("FAKE-TOKEN-123");
    vi.mocked(getPlexAccount).mockRejectedValue(new PlexRequestError("Plex account request failed: network error", "network"));
    const response = await callback(state);
    expect(location(response)).toBe(`${ORIGIN}/setup?plex=error`);
  });
});

describe("POST /plex/setup/complete", () => {
  it("rejects a missing state cookie with 400 expired", async () => {
    const response = await setupComplete(undefined, SERVER_ID);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "expired" });
  });

  it("rejects a serverId that wasn't offered with 400", async () => {
    const cookie = await setupStateCookie();
    const response = await setupComplete(cookie, "fake-not-offered");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unknown-server" });
    expect(getPlexAdminConfig()).toBeNull();
    expect(clearsCookie(response, "mediahub_plex_setup")).toBe(true);
  });

  it("rejects a body with extra fields", async () => {
    const cookie = await setupStateCookie();
    const response = await send("/plex/setup/complete", {
      cookie: `mediahub_plex_setup=${cookie}`,
      json: { serverId: SERVER_ID, extra: true },
    });
    expect(response.status).toBe(400);
  });

  it("is one-time: a second use of the same state gets 400 expired", async () => {
    const cookie = await setupStateCookie();
    const first = await setupComplete(cookie, SERVER_ID);
    expect(first.status).toBe(200);
    const second = await setupComplete(cookie, SERVER_ID);
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({ error: "expired" });
  });

  it("refuses with 409 when setup is already done", async () => {
    const cookie = await setupStateCookie();
    claimPlexAdminConfig({ serverId: "fake-other", serverName: "Other", ownerAccountId: "5" });
    const response = await setupComplete(cookie, SERVER_ID);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "already-set-up" });
    expect(clearsCookie(response, "mediahub_plex_setup")).toBe(true);
  });

  it("refuses with 409 when another setup wins the claim race", async () => {
    const cookie = await setupStateCookie();
    // This request's pre-check sees no config, but the row is already stored when the claim runs.
    claimPlexAdminConfig({ serverId: "fake-other", serverName: "Other", ownerAccountId: "5" });
    vi.mocked(getPlexAdminConfig).mockReturnValueOnce(null);
    const response = await setupComplete(cookie, SERVER_ID);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "already-set-up" });
    expect(getPlexAdminConfig()?.serverId).toBe("fake-other");
  });

  it("merge rule 1: a user already linked to the Plex account becomes admin and is signed in", async () => {
    const linked = await createPlexUser(String(OWNER.id), "requester", "owner@example.test");
    const cookie = await setupStateCookie();
    const response = await setupComplete(cookie, SERVER_ID);
    expect(response.status).toBe(200);
    expect(hasSessionCookie(response)).toBe(true);
    expect(clearsCookie(response, "mediahub_plex_setup")).toBe(true);
    const user = await (await auth.$context).internalAdapter.findUserById(linked);
    expect(roleOf(user)).toBe("admin");
    expect(getPlexAdminConfig()).toEqual({ serverId: SERVER_ID, serverName: "Fake Server", ownerAccountId: String(OWNER.id) });
  });

  it("merge rule 2: the single admin without Plex keeps its id, loses its password and old sessions", async () => {
    const adminId = await createUserWithPassword("gary@example.test", "admin");
    const ctx = await auth.$context;
    const oldSession = await ctx.internalAdapter.createSession(adminId);

    const cookie = await setupStateCookie();
    const response = await setupComplete(cookie, SERVER_ID);
    expect(response.status).toBe(200);

    const accounts = await ctx.internalAdapter.findAccounts(adminId);
    expect(accounts.map((a) => a.providerId)).toEqual(["plex"]);
    expect(accounts[0]!.accountId).toBe(String(OWNER.id));
    expect(await ctx.internalAdapter.findSession(oldSession.token)).toBeNull();
    expect(hasSessionCookie(response)).toBe(true);
  });

  it("merge rule 3: with no admin to merge, a new admin takes the Plex email", async () => {
    const cookie = await setupStateCookie();
    const response = await setupComplete(cookie, SERVER_ID);
    expect(response.status).toBe(200);
    const found = await (await auth.$context).internalAdapter.findUserByEmail(OWNER.email);
    expect(roleOf(found?.user)).toBe("admin");
  });

  it("merge rule 3: a Plex email already used by another user gets the placeholder", async () => {
    await createUserWithPassword(OWNER.email, "requester");
    const cookie = await setupStateCookie();
    const response = await setupComplete(cookie, SERVER_ID);
    expect(response.status).toBe(200);
    const ctx = await auth.$context;
    const placeholder = await ctx.internalAdapter.findUserByEmail(`plex-${OWNER.id}@users.plex.invalid`);
    expect(roleOf(placeholder?.user)).toBe("admin");
  });

  it("merge rule 3: a missing Plex email gets the placeholder too", async () => {
    const state = await startFlow();
    approve({ ...OWNER, email: null as unknown as string });
    const cb = await callback(state);
    const cookie = setCookieValue(cb, "mediahub_plex_setup")!;
    const response = await setupComplete(cookie, SERVER_ID);
    expect(response.status).toBe(200);
    const found = await (await auth.$context).internalAdapter.findUserByEmail(`plex-${OWNER.id}@users.plex.invalid`);
    expect(roleOf(found?.user)).toBe("admin");
  });
});

describe("sign-in with email and password", () => {
  it("still lets the old admin use a password before Plex is set up", async () => {
    await createUserWithPassword("gary@example.test", "admin");
    const response = await send("/sign-in/email", { json: { email: "gary@example.test", password: "fake-password-long-enough" } });
    expect(response.status).toBe(200);
    expect(hasSessionCookie(response)).toBe(true);
  });

  it("refuses an admin with the same reply as a wrong password, and as an unknown email", async () => {
    await createUserWithPassword("gary@example.test", "admin");
    claimPlexAdminConfig(CONFIG);
    const body = (email: string) => ({ json: { email, password: "fake-password-long-enough" } });

    const adminReply = await send("/sign-in/email", body("  Gary@Example.test "));
    const unknownReply = await send("/sign-in/email", body("nobody@example.test"));

    expect(adminReply.status).toBe(401);
    expect(unknownReply.status).toBe(401);
    const adminBody = await adminReply.json();
    expect(adminBody).toEqual(await unknownReply.json());
    expect(adminBody).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });
    expect(hasSessionCookie(adminReply)).toBe(false);
  });

  it("still lets a requester sign in with a password", async () => {
    await createUserWithPassword("req@example.test", "requester");
    const response = await send("/sign-in/email", { json: { email: "req@example.test", password: "fake-password-long-enough" } });
    expect(response.status).toBe(200);
    expect(hasSessionCookie(response)).toBe(true);
  });
});

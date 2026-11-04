import "server-only";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import {
  PasswordSetupError,
  createRequester,
  deleteRequester,
  listUsers,
  setRequesterPassword,
  signOutUser,
  type AuthContext,
} from "./index";

// A real Better Auth instance on an in-memory database with the real migrations. Only the email and password
// plugin is used, with the same role field as src/server/auth.ts. Every value here is fake.

// Fake values only. Nothing here is a real credential.
const PASSWORD = "fake-password-12345";
const NEW_PASSWORD = "fake-new-password-6789";

let db: BetterSQLite3Database<typeof schema>;
let auth: ReturnType<typeof buildAuth>;
let ctx: AuthContext;

function buildAuth() {
  return betterAuth({
    baseURL: "https://mediahub.example.test",
    secret: "fake-test-secret-0123456789abcdefghijklmn",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true },
    user: {
      additionalFields: {
        role: { type: ["admin", "requester"], required: false, defaultValue: "requester", input: false },
      },
    },
  });
}

beforeEach(async () => {
  db = drizzle(new Database(":memory:"), { schema });
  migrate(db, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  auth = buildAuth();
  // The test instance has no plugins, so its context type is narrower than the app's. The module only uses the
  // internal adapter and the password hasher, which both have the same types here.
  ctx = (await auth.$context) as unknown as AuthContext;
});

/** Creates an admin the way a Plex sign-in would leave one: a known role and a password account. */
async function makeAdmin(email: string): Promise<string> {
  const user = await ctx.internalAdapter.createUser(
    { email, name: "Fake Admin", role: "admin", emailVerified: false },
    { method: "email-password" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(PASSWORD),
  });
  return user.id;
}

/** Creates a requester through the module under test and returns the id. */
async function makeRequester(email: string, password = PASSWORD): Promise<string> {
  // Names are sign-in names and can't contain @, so the email's local part is the name.
  const outcome = await createRequester(ctx, { name: email.split("@")[0] ?? "fake", email, password });
  expect(outcome).toEqual({ ok: true });
  const row = await ctx.internalAdapter.findUserByEmail(email);
  return row!.user.id;
}

async function canSignIn(email: string, password: string): Promise<boolean> {
  try {
    await auth.api.signInEmail({ body: { email, password } });
    return true;
  } catch {
    return false;
  }
}

function sessionCount(userId: string): number {
  return db.select().from(schema.session).where(eq(schema.session.userId, userId)).all().length;
}

function accountCount(userId: string): number {
  return db.select().from(schema.account).where(eq(schema.account.userId, userId)).all().length;
}

function userExists(userId: string): boolean {
  return db.select().from(schema.user).where(eq(schema.user.id, userId)).all().length === 1;
}

const UNKNOWN_ID = "fake-missing-user-id";

describe("createRequester", () => {
  it("creates a requester who can sign in with that password", async () => {
    await makeRequester("fake.requester@example.test", PASSWORD);

    const row = db.select().from(schema.user).where(eq(schema.user.email, "fake.requester@example.test")).get();
    expect(row?.role).toBe("requester");
    expect(await canSignIn("fake.requester@example.test", PASSWORD)).toBe(true);
    expect(await canSignIn("fake.requester@example.test", NEW_PASSWORD)).toBe(false);
  });

  it("lowercases and trims the email", async () => {
    expect(await createRequester(ctx, { name: "Fake", email: "  Fake.Upper@Example.TEST ", password: PASSWORD })).toEqual({
      ok: true,
    });
    expect(await canSignIn("fake.upper@example.test", PASSWORD)).toBe(true);
  });

  it("refuses a duplicate email, ignoring case, and creates nothing", async () => {
    await makeRequester("fake.dupe@example.test");
    const before = db.select().from(schema.user).all().length;

    expect(await createRequester(ctx, { name: "Other", email: "FAKE.DUPE@example.test", password: NEW_PASSWORD })).toEqual({
      ok: false,
      reason: "email-taken",
    });
    expect(db.select().from(schema.user).all().length).toBe(before);
  });

  it("deletes the partial user and throws when the password cannot be stored", async () => {
    const hash = vi.spyOn(ctx.password, "hash").mockRejectedValueOnce(new Error("fake hash failure"));

    await expect(
      createRequester(ctx, { name: "Fake", email: "fake.partial@example.test", password: PASSWORD }),
    ).rejects.toMatchObject({ name: "PasswordSetupError", message: "fake hash failure", removed: true });
    expect(hash).toHaveBeenCalledOnce();
    expect(await ctx.internalAdapter.findUserByEmail("fake.partial@example.test")).toBeNull();
    expect(db.select().from(schema.user).all()).toEqual([]);
  });

  it("reports when the partial user could not be removed", async () => {
    vi.spyOn(ctx.password, "hash").mockRejectedValueOnce(new Error("fake hash failure"));
    vi.spyOn(ctx.internalAdapter, "deleteUser").mockRejectedValueOnce(new Error("fake delete failure"));

    const error = await createRequester(ctx, { name: "Fake", email: "fake.stuck@example.test", password: PASSWORD }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PasswordSetupError);
    expect(error).toMatchObject({ message: "fake hash failure", removed: false });
  });

  it.each([11, 129])("refuses a password of %i characters and leaves no user behind", async (length) => {
    await expect(
      createRequester(ctx, { name: "Fake", email: "fake.short@example.test", password: "a".repeat(length) }),
    ).rejects.toMatchObject({ name: "PasswordSetupError", removed: true });
    expect(db.select().from(schema.user).all()).toEqual([]);
  });
});

describe("createRequester sign-in names", () => {
  it("refuses a name containing @ and creates nothing", async () => {
    expect(await createRequester(ctx, { name: "fake@example.test", email: "fake.at@example.test", password: PASSWORD })).toEqual({
      ok: false,
      reason: "name-invalid",
    });
    expect(await ctx.internalAdapter.findUserByEmail("fake.at@example.test")).toBeNull();
  });

  it("refuses a duplicate name, ignoring case and extra spaces, and creates nothing", async () => {
    expect(await createRequester(ctx, { name: "Amy  Pond", email: "amy.one@example.test", password: PASSWORD })).toEqual({
      ok: true,
    });
    expect(await createRequester(ctx, { name: " amy pond", email: "amy.two@example.test", password: NEW_PASSWORD })).toEqual({
      ok: false,
      reason: "name-taken",
    });
    expect(await ctx.internalAdapter.findUserByEmail("amy.two@example.test")).toBeNull();
  });

  it("accepts a unique name and stores it trimmed", async () => {
    expect(await createRequester(ctx, { name: "  Rory Williams  ", email: "rory@example.test", password: PASSWORD })).toEqual({
      ok: true,
    });
    const row = await ctx.internalAdapter.findUserByEmail("rory@example.test");
    expect(row?.user.name).toBe("Rory Williams");
  });
});

describe("listUsers", () => {
  it("returns only the listed fields, admins first then by email", async () => {
    await makeRequester("fake.zed@example.test");
    await makeRequester("fake.amy@example.test");
    await makeAdmin("fake.admin@example.test");

    const users = await listUsers(ctx);

    expect(users.map((user) => [user.role, user.email])).toEqual([
      ["admin", "fake.admin@example.test"],
      ["requester", "fake.amy@example.test"],
      ["requester", "fake.zed@example.test"],
    ]);
    for (const user of users) {
      expect(Object.keys(user).sort()).toEqual(["createdAt", "email", "id", "name", "role"]);
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(JSON.stringify(user)).not.toContain("password");
    }
  });

  it("leaves out a user whose role is not a known role", async () => {
    await makeRequester("fake.known@example.test");
    const rows = await ctx.internalAdapter.listUsers(undefined, undefined, undefined, undefined);
    const known = rows[0];
    vi.spyOn(ctx.internalAdapter, "listUsers").mockResolvedValueOnce([
      ...rows,
      { ...known, id: "fake-odd-id", email: "fake.odd@example.test", role: "owner" } as unknown as (typeof rows)[number],
    ]);

    const users = await listUsers(ctx);
    expect(users.map((user) => user.email)).toEqual(["fake.known@example.test"]);
  });
});

describe("setRequesterPassword", () => {
  it("changes the password: the old one stops working and the new one works", async () => {
    const id = await makeRequester("fake.reset@example.test");

    expect(await setRequesterPassword(ctx, id, NEW_PASSWORD)).toEqual({ ok: true });
    expect(await canSignIn("fake.reset@example.test", PASSWORD)).toBe(false);
    expect(await canSignIn("fake.reset@example.test", NEW_PASSWORD)).toBe(true);
  });

  it("refuses a password outside the length limits and keeps the old one", async () => {
    const id = await makeRequester("fake.length@example.test");

    await expect(setRequesterPassword(ctx, id, "a".repeat(11))).rejects.toThrow(RangeError);
    expect(await canSignIn("fake.length@example.test", PASSWORD)).toBe(true);
  });

  it("deletes the requester's existing sessions", async () => {
    const id = await makeRequester("fake.sessions@example.test");
    await auth.api.signInEmail({ body: { email: "fake.sessions@example.test", password: PASSWORD } });
    expect(sessionCount(id)).toBe(1);

    await setRequesterPassword(ctx, id, NEW_PASSWORD);
    expect(sessionCount(id)).toBe(0);
  });

  it("creates a credential account when the user has none", async () => {
    const id = await makeRequester("fake.nocred@example.test");
    db.delete(schema.account).where(eq(schema.account.userId, id)).run();
    expect(accountCount(id)).toBe(0);

    expect(await setRequesterPassword(ctx, id, NEW_PASSWORD)).toEqual({ ok: true });
    expect(await canSignIn("fake.nocred@example.test", NEW_PASSWORD)).toBe(true);
  });

  it("refuses an admin and leaves the admin's password and sessions untouched", async () => {
    const id = await makeAdmin("fake.boss@example.test");
    await auth.api.signInEmail({ body: { email: "fake.boss@example.test", password: PASSWORD } });
    const sessions = sessionCount(id);

    expect(await setRequesterPassword(ctx, id, NEW_PASSWORD)).toEqual({ ok: false, reason: "not-requester" });
    expect(sessionCount(id)).toBe(sessions);
    expect(await canSignIn("fake.boss@example.test", PASSWORD)).toBe(true);
    expect(await canSignIn("fake.boss@example.test", NEW_PASSWORD)).toBe(false);
  });

  it("returns not-found for an unknown id", async () => {
    expect(await setRequesterPassword(ctx, UNKNOWN_ID, NEW_PASSWORD)).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("signOutUser", () => {
  it("deletes all of a requester's sessions and keeps the password", async () => {
    const id = await makeRequester("fake.signout@example.test");
    await auth.api.signInEmail({ body: { email: "fake.signout@example.test", password: PASSWORD } });
    await auth.api.signInEmail({ body: { email: "fake.signout@example.test", password: PASSWORD } });
    expect(sessionCount(id)).toBe(2);

    expect(await signOutUser(ctx, id)).toEqual({ ok: true });
    expect(sessionCount(id)).toBe(0);
    expect(await canSignIn("fake.signout@example.test", PASSWORD)).toBe(true);
  });

  it("refuses an admin and leaves the admin's sessions untouched", async () => {
    const id = await makeAdmin("fake.keep@example.test");
    await auth.api.signInEmail({ body: { email: "fake.keep@example.test", password: PASSWORD } });
    const sessions = sessionCount(id);

    expect(await signOutUser(ctx, id)).toEqual({ ok: false, reason: "not-requester" });
    expect(sessionCount(id)).toBe(sessions);
  });

  it("returns not-found for an unknown id", async () => {
    expect(await signOutUser(ctx, UNKNOWN_ID)).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("deleteRequester", () => {
  it("removes the user with their sessions and accounts", async () => {
    const id = await makeRequester("fake.gone@example.test");
    await auth.api.signInEmail({ body: { email: "fake.gone@example.test", password: PASSWORD } });
    expect(sessionCount(id)).toBe(1);
    expect(accountCount(id)).toBe(1);

    expect(await deleteRequester(ctx, id)).toEqual({ ok: true });
    expect(userExists(id)).toBe(false);
    expect(sessionCount(id)).toBe(0);
    expect(accountCount(id)).toBe(0);
    expect(await canSignIn("fake.gone@example.test", PASSWORD)).toBe(false);
  });

  it("refuses an admin and leaves the admin, their sessions and password untouched", async () => {
    const id = await makeAdmin("fake.safe@example.test");
    await auth.api.signInEmail({ body: { email: "fake.safe@example.test", password: PASSWORD } });
    const sessions = sessionCount(id);

    expect(await deleteRequester(ctx, id)).toEqual({ ok: false, reason: "not-requester" });
    expect(userExists(id)).toBe(true);
    expect(sessionCount(id)).toBe(sessions);
    expect(await canSignIn("fake.safe@example.test", PASSWORD)).toBe(true);
  });

  it("returns not-found for an unknown id", async () => {
    expect(await deleteRequester(ctx, UNKNOWN_ID)).toEqual({ ok: false, reason: "not-found" });
  });
});

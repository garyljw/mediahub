import "server-only";
import type { Auth } from "../auth";
import { isRole, type Role } from "../roles";
import { isValidSignInName, normalizeName } from "./names";

// Requester account management, shared by the Settings → Users server actions and scripts/create-user.ts.
// Every function takes the Better Auth context as a parameter, so tests can pass a test instance.
// Every function that changes an account first re-reads the target from the DB and refuses anything that is
// not a requester. The caller's word is never trusted for the role.

export type AuthContext = Awaited<Auth["$context"]>;

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/components/settings/password-limits";

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH };

/** The only user fields that leave this module. */
export type UserSummary = { id: string; name: string; email: string; role: Role; createdAt: Date };

export type RequesterRefusal = { ok: false; reason: "not-found" | "not-requester" };
export type RequesterOutcome = { ok: true } | RequesterRefusal;
export type CreateRequesterOutcome =
  | { ok: true }
  | { ok: false; reason: "email-taken" | "name-taken" | "name-invalid" };

export type NewRequester = { name: string; email: string; password: string };

/**
 * Thrown when a requester was created but the password could not be stored. `removed` says whether the
 * partial user was deleted. The message is the underlying error's message, which never contains the password.
 */
export class PasswordSetupError extends Error {
  constructor(
    message: string,
    readonly removed: boolean,
  ) {
    super(message);
    this.name = "PasswordSetupError";
  }
}

/** Role is an additional field, so it is not in Better Auth's base User type. Read it defensively. */
function roleOf(user: object): unknown {
  return "role" in user ? user.role : undefined;
}

/**
 * Sets a user's password through the credential account: updates the existing account, or creates one if the
 * user has none. Uses Better Auth's own password hasher, so the stored hash matches sign-in.
 */
async function setCredentialPassword(ctx: AuthContext, userId: string, password: string): Promise<void> {
  // Callers validate too. This keeps a bad length from ever being stored, since sign-in would refuse it.
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(`password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`);
  }
  const passwordHash = await ctx.password.hash(password);
  const credential = await ctx.internalAdapter.findCredentialAccount(userId);
  if (credential) {
    await ctx.internalAdapter.updateAccount(credential.id, { password: passwordHash });
    return;
  }
  await ctx.internalAdapter.linkAccount({
    userId,
    providerId: "credential",
    accountId: userId,
    password: passwordHash,
  });
}

/** Re-reads the target. Only a user whose stored role is exactly "requester" passes. Unknown roles fail closed. */
async function checkRequester(ctx: AuthContext, userId: string): Promise<RequesterOutcome> {
  const user = await ctx.internalAdapter.findUserById(userId);
  if (!user) return { ok: false, reason: "not-found" };
  if (roleOf(user) !== "requester") return { ok: false, reason: "not-requester" };
  return { ok: true };
}

/**
 * Every user whose stored role is a known role, admins first, then by email. Unknown roles are left out, so
 * they can never be managed from here. Only the UserSummary fields are returned.
 */
export async function listUsers(ctx: AuthContext): Promise<UserSummary[]> {
  // Without a limit the adapter returns at most 100 rows. MediaHub has a handful of users, so this is never reached.
  const rows = await ctx.internalAdapter.listUsers(10_000, undefined, undefined, undefined);
  const users: UserSummary[] = [];
  for (const row of rows) {
    const role = roleOf(row);
    if (!isRole(role)) continue;
    users.push({ id: row.id, name: row.name, email: row.email, role, createdAt: row.createdAt });
  }
  return users.sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    if (a.email === b.email) return 0;
    return a.email < b.email ? -1 : 1;
  });
}

/**
 * Creates a requester with a password sign-in. The role is always "requester". Admins are never created here.
 * If the password cannot be stored, the partial user is deleted and a PasswordSetupError is thrown.
 */
export async function createRequester(ctx: AuthContext, input: NewRequester): Promise<CreateRequesterOutcome> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!isValidSignInName(name)) return { ok: false, reason: "name-invalid" };
  if (await ctx.internalAdapter.findUserByEmail(email)) return { ok: false, reason: "email-taken" };
  // Names are sign-in names, so they must be unique across every account, admins included.
  const wanted = normalizeName(name);
  const rows = await ctx.internalAdapter.listUsers(10_000, undefined, undefined, undefined);
  if (rows.some((row) => normalizeName(row.name) === wanted)) return { ok: false, reason: "name-taken" };

  const user = await ctx.internalAdapter.createUser(
    { email, name, role: "requester", emailVerified: false },
    { method: "email-password" },
  );
  try {
    await setCredentialPassword(ctx, user.id, input.password);
  } catch (error) {
    // Without a credential account the user cannot sign in, so remove the partial user.
    const message = error instanceof Error ? error.message : "unexpected error.";
    try {
      await ctx.internalAdapter.deleteUser(user.id);
    } catch {
      throw new PasswordSetupError(message, false);
    }
    throw new PasswordSetupError(message, true);
  }
  return { ok: true };
}

/** Sets a new password for a requester and signs them out everywhere. */
export async function setRequesterPassword(
  ctx: AuthContext,
  userId: string,
  password: string,
): Promise<RequesterOutcome> {
  const check = await checkRequester(ctx, userId);
  if (!check.ok) return check;
  await setCredentialPassword(ctx, userId, password);
  // Revoke existing sessions so whoever had the old password is signed out.
  await ctx.internalAdapter.deleteUserSessions(userId);
  return { ok: true };
}

/** Deletes every session of a requester. */
export async function signOutUser(ctx: AuthContext, userId: string): Promise<RequesterOutcome> {
  const check = await checkRequester(ctx, userId);
  if (!check.ok) return check;
  await ctx.internalAdapter.deleteUserSessions(userId);
  return { ok: true };
}

/**
 * Deletes a requester with their sessions and accounts. Better Auth's deleteUser removes both before the user
 * row, so nothing is left behind.
 */
export async function deleteRequester(ctx: AuthContext, userId: string): Promise<RequesterOutcome> {
  const check = await checkRequester(ctx, userId);
  if (!check.ok) return check;
  await ctx.internalAdapter.deleteUser(userId);
  return { ok: true };
}

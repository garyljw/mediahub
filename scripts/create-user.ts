// Creates a user, changes a user's role, or resets a user's password. There is no
// email flow, so this script is the only way to manage accounts.
//
// Usage:
//   npm run create-user -- --email you@example.com --role requester [--name "Name"]
//   npm run create-user -- --email you@example.com --role requester --set-role
//   npm run create-user -- --email you@example.com --reset-password
//
// Admins sign in with Plex only, so this script never creates or makes an admin, and never resets an
// admin's password. To set Plex up again, run `npm run reset-plex-admin`.
// --role has no default, so a user is never created by accident.
// Passwords are only read from a hidden interactive prompt, never from argv or env.
//
// Why --conditions=react-server (set in package.json): src/server/* imports
// "server-only", which throws outside React Server Components. The package maps
// the "react-server" export condition to an empty module, so passing that
// condition lets these modules load in plain Node without a Next.js runtime.
//
// Why internalAdapter instead of auth.api.signUpEmail: sign-up is disabled
// (emailAndPassword.disableSignUp), and that check runs inside the endpoint, so
// the endpoint refuses even server-side calls. We use Better Auth's own
// password hasher and adapter, so the stored hash format matches sign-in.

import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { z } from "zod";
import { getAuth, type Auth } from "../src/server/auth";
import { ROLES, isRole, type Role } from "../src/server/roles";

const MIN_PASSWORD_LENGTH = 12;
// Matches Better Auth's default emailAndPassword.maxPasswordLength (128). It is
// hardcoded in better-auth/dist/context/create-context.mjs and not exported, so keep the two in step.
const MAX_PASSWORD_LENGTH = 128;
const ADMIN_REFUSAL = "Admins sign in with Plex. Run `npm run reset-plex-admin` to set Plex up again.";

type AuthContext = Awaited<Auth["$context"]>;

function fail(message: string): never {
  console.error(`create-user: ${message}`);
  process.exit(1);
}

/** Role is an additional field, so it is not in the base User type. Read it defensively. */
function isAdminUser(user: object): boolean {
  return "role" in user && user.role === "admin";
}

/** Reads a line from the terminal without echoing it. Rejects if input closes first (Ctrl+D). */
function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) fail("this must be run in an interactive terminal.");
  return new Promise((resolve, reject) => {
    // Discarding the output stops readline from echoing typed characters.
    const silent = new Writable({ write: (_chunk, _enc, done) => done() });
    const rl = createInterface({ input: process.stdin, output: silent, terminal: true });
    let answered = false;
    process.stdout.write(prompt);
    rl.question("", (answer) => {
      answered = true;
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    // Closing after an answer is normal. Only a close before an answer (Ctrl+D) is an abort.
    rl.on("close", () => {
      if (!answered) {
        process.stdout.write("\n");
        reject(new Error("Aborted: no password entered."));
      }
    });
  });
}

/** Prompts for a new password twice. Enforces the length limits. */
async function askNewPassword(): Promise<string> {
  const password = await readHidden("Password: ");
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    fail(`password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  const confirm = await readHidden("Confirm password: ");
  if (confirm !== password) fail("passwords do not match.");
  return password;
}

/**
 * Sets a user's password through the credential account: updates the existing
 * account, or creates one if the user has none (a half-created user). Uses
 * Better Auth's own password hasher, so the stored hash matches sign-in.
 */
async function setCredentialPassword(ctx: AuthContext, userId: string, password: string) {
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

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      "set-role": { type: "boolean", default: false },
      "reset-password": { type: "boolean", default: false },
    },
    strict: true,
  });

  const parsedEmail = z.email().safeParse(values.email?.trim().toLowerCase());
  if (!parsedEmail.success) fail("pass a valid --email <address>.");
  const email = parsedEmail.data;

  const roleInput = values.role;
  if (roleInput !== undefined && !isRole(roleInput)) {
    fail(`--role must be one of: ${ROLES.join(", ")}.`);
  }
  const role: Role | undefined = roleInput;
  if (role === "admin") fail(ADMIN_REFUSAL);
  const setRole = values["set-role"];
  const resetPassword = values["reset-password"];

  if (setRole && resetPassword) fail("use --set-role and --reset-password separately.");
  if (resetPassword && role !== undefined) {
    fail("--role cannot be combined with --reset-password. Use --set-role to change a role.");
  }
  if (!resetPassword && role === undefined) {
    fail(`--role is required (${ROLES.join(" or ")}). There is no default.`);
  }

  const ctx = await getAuth().$context;
  const existing = await ctx.internalAdapter.findUserByEmail(email);

  if (resetPassword) {
    if (!existing) fail("no user with that email. Create them with --role requester.");
    if (isAdminUser(existing.user)) fail(ADMIN_REFUSAL);
    const userId = existing.user.id;
    await setCredentialPassword(ctx, userId, await askNewPassword());
    // Revoke existing sessions so whoever had the old password is signed out.
    await ctx.internalAdapter.deleteUserSessions(userId);
    console.log(`Password reset for ${email}. Existing sessions were signed out.`);
    return;
  }

  if (existing) {
    if (!setRole) {
      fail(
        "a user with that email already exists. Use --set-role to change their role, or --reset-password to set a new password.",
      );
    }
    const currentRole: unknown = (existing.user as Record<string, unknown>).role;
    if (currentRole === role) {
      console.log(`${email} already has role ${role}. Nothing to do.`);
      return;
    }
    await ctx.internalAdapter.updateUser(existing.user.id, { role });
    console.log(`Set role of ${email} to ${role}.`);
    return;
  }

  if (setRole) fail("no user with that email to change. Omit --set-role to create one.");

  const name = values.name?.trim() || email.split("@")[0];
  // Ask for the password before creating anything, so an aborted prompt leaves no user behind.
  const password = await askNewPassword();

  const user = await ctx.internalAdapter.createUser(
    { email, name, role, emailVerified: false },
    { method: "email-password" },
  );
  try {
    await setCredentialPassword(ctx, user.id, password);
  } catch (error) {
    // Without a credential account the user cannot sign in, so remove the partial user.
    const message = error instanceof Error ? error.message : "unexpected error.";
    try {
      await ctx.internalAdapter.deleteUser(user.id);
    } catch {
      fail(
        `password setup failed (${message}) and the partial user ${email} could not be removed. Run --reset-password to repair it, or delete it manually.`,
      );
    }
    fail(`password setup failed (${message}). The partial user ${email} was removed; nothing was created.`);
  }
  console.log(`Created ${role} ${email}.`);
}

main().catch((error: unknown) => {
  // Print only the message. Config errors list variable names, never values.
  fail(error instanceof Error ? error.message : "unexpected error.");
});

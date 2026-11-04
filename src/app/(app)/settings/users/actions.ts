"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { getAuth } from "@/server/auth";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PasswordSetupError,
  createRequester,
  deleteRequester,
  setRequesterPassword,
  signOutUser,
  type RequesterRefusal,
} from "@/server/users";

export type UsersResult = { ok: true } | { ok: false; message: string };

const DENIED = "You don't have permission to manage users.";
const INVALID_ADD = `Enter a name without @, a valid email and a password of ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`;
const INVALID_RESET = `Choose a user and enter a password of ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`;
const INVALID_USER = "Choose a user first.";

// strictObject rejects unknown keys. Passwords are never echoed back in a message.
const PasswordInput = z
  .string()
  .min(MIN_PASSWORD_LENGTH)
  .max(MAX_PASSWORD_LENGTH);

const AddInput = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((name) => !name.includes("@")),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: PasswordInput,
});

const ResetInput = z.strictObject({
  userId: z.string().min(1).max(100),
  password: PasswordInput,
});

const UserIdInput = z.strictObject({
  userId: z.string().min(1).max(100),
});

const CREATE_REFUSALS = {
  "email-taken": "A user with that email already exists.",
  "name-taken": "A user with that name already exists. Names are used to sign in, so each must be different.",
  "name-invalid": INVALID_ADD,
} as const;

const NOT_FOUND = "That user no longer exists.";
const NOT_REQUESTER = "Admins are managed with Plex sign-in, not here.";

/** Maps a refusal from the users module to the message the browser shows. */
function refusalMessage(refusal: RequesterRefusal): UsersResult {
  return { ok: false, message: refusal.reason === "not-found" ? NOT_FOUND : NOT_REQUESTER };
}

/** Creates a requester with a password (admin only). Admins are never created here. */
export async function addRequester(input: unknown): Promise<UsersResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const parsed = AddInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID_ADD };

  let outcome;
  try {
    outcome = await createRequester(await getAuth().$context, parsed.data);
  } catch (error) {
    if (!(error instanceof PasswordSetupError)) throw error;
    // The message comes from the adapter and never contains the password, but it isn't for the browser either.
    console.error(`Add requester: password setup failed: ${error.message}`);
    return {
      ok: false,
      message: error.removed
        ? "Couldn't set the password, so nothing was created."
        : "Couldn't set the password. Delete the half-created user below and try again.",
    };
  }
  if (!outcome.ok) return { ok: false, message: CREATE_REFUSALS[outcome.reason] };
  revalidatePath("/settings/users");
  return { ok: true };
}

/** Sets a requester's password and signs them out everywhere (admin only). */
export async function resetRequesterPassword(input: unknown): Promise<UsersResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const parsed = ResetInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID_RESET };

  const outcome = await setRequesterPassword(await getAuth().$context, parsed.data.userId, parsed.data.password);
  if (!outcome.ok) return refusalMessage(outcome);
  revalidatePath("/settings/users");
  return { ok: true };
}

/** Deletes every session of a requester (admin only). */
export async function signOutRequester(input: unknown): Promise<UsersResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const parsed = UserIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID_USER };

  const outcome = await signOutUser(await getAuth().$context, parsed.data.userId);
  if (!outcome.ok) return refusalMessage(outcome);
  revalidatePath("/settings/users");
  return { ok: true };
}

/** Deletes a requester and their sessions and accounts (admin only). */
export async function deleteRequesterAccount(input: unknown): Promise<UsersResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const parsed = UserIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID_USER };

  const outcome = await deleteRequester(await getAuth().$context, parsed.data.userId);
  if (!outcome.ok) return refusalMessage(outcome);
  revalidatePath("/settings/users");
  return { ok: true };
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  createRequester: vi.fn(),
  setRequesterPassword: vi.fn(),
  signOutUser: vi.fn(),
  deleteRequester: vi.fn(),
  revalidatePath: vi.fn(),
  context: { fake: "auth-context" },
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

vi.mock("@/server/auth", () => ({ getAuth: () => ({ $context: Promise.resolve(mocks.context) }) }));

vi.mock("@/server/users", () => ({
  PasswordSetupError: class PasswordSetupError extends Error {
    constructor(
      message: string,
      readonly removed: boolean,
    ) {
      super(message);
    }
  },
  MIN_PASSWORD_LENGTH: 12,
  MAX_PASSWORD_LENGTH: 128,
  createRequester: mocks.createRequester,
  setRequesterPassword: mocks.setRequesterPassword,
  signOutUser: mocks.signOutUser,
  deleteRequester: mocks.deleteRequester,
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { AuthzError } from "@/server/authz";
import { PasswordSetupError } from "@/server/users";
import { addRequester, deleteRequesterAccount, resetRequesterPassword, signOutRequester } from "./actions";

const DENIED = "You don't have permission to manage users.";
const INVALID_ADD = "Enter a name without @, a valid email and a password of 12 to 128 characters.";
const INVALID_RESET = "Choose a user and enter a password of 12 to 128 characters.";
const INVALID_USER = "Choose a user first.";
const NOT_FOUND = "That user no longer exists.";
const NOT_REQUESTER = "Admins are managed with Plex sign-in, not here.";

// Fake values only. Nothing here is a real credential.
const PASSWORD = "fake-password-12345";
const ADD_INPUT = { name: "Fake Person", email: "fake.person@example.test", password: PASSWORD };
const RESET_INPUT = { userId: "fake-user-1", password: PASSWORD };
const USER_INPUT = { userId: "fake-user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "a1", email: "admin@example.test", name: "A", role: "admin" } });
  mocks.createRequester.mockResolvedValue({ ok: true });
  mocks.setRequesterPassword.mockResolvedValue({ ok: true });
  mocks.signOutUser.mockResolvedValue({ ok: true });
  mocks.deleteRequester.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const actions = [
  ["addRequester", addRequester, ADD_INPUT],
  ["resetRequesterPassword", resetRequesterPassword, RESET_INPUT],
  ["signOutRequester", signOutRequester, USER_INPUT],
  ["deleteRequesterAccount", deleteRequesterAccount, USER_INPUT],
] as const;

describe("authorization", () => {
  it.each(actions)("%s checks for the admin role", async (_name, action, input) => {
    await action(input);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  // A signed-out caller (401) gets the same AuthzError branch as a requester (403), so one status is enough.
  it.each(actions)("%s refuses a requester and never touches the users module", async (_name, action, input) => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await action(input)).toEqual({ ok: false, message: DENIED });
    expect(mocks.createRequester).not.toHaveBeenCalled();
    expect(mocks.setRequesterPassword).not.toHaveBeenCalled();
    expect(mocks.signOutUser).not.toHaveBeenCalled();
    expect(mocks.deleteRequester).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(actions)("%s rethrows errors that are not authorization failures", async (_name, action, input) => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(action(input)).rejects.toThrow("database down");
    expect(mocks.createRequester).not.toHaveBeenCalled();
    expect(mocks.setRequesterPassword).not.toHaveBeenCalled();
    expect(mocks.signOutUser).not.toHaveBeenCalled();
    expect(mocks.deleteRequester).not.toHaveBeenCalled();
  });
});

describe("addRequester", () => {
  it("creates the requester with the trimmed, parsed fields and revalidates the page", async () => {
    expect(
      await addRequester({ name: "  Fake Person  ", email: "  Fake.Person@Example.TEST ", password: PASSWORD }),
    ).toEqual({ ok: true });
    expect(mocks.createRequester).toHaveBeenCalledWith(mocks.context, {
      name: "Fake Person",
      email: "fake.person@example.test",
      password: PASSWORD,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });

  it.each([
    ["an extra key", { ...ADD_INPUT, role: "admin" }],
    ["a missing name", { email: ADD_INPUT.email, password: PASSWORD }],
    ["an empty name", { ...ADD_INPUT, name: "   " }],
    ["a name over 100 characters", { ...ADD_INPUT, name: "n".repeat(101) }],
    ["a name containing @", { ...ADD_INPUT, name: "fake@example.test" }],
    ["a bad email", { ...ADD_INPUT, email: "not-an-email" }],
    ["a password of 11 characters", { ...ADD_INPUT, password: "a".repeat(11) }],
    ["a password of 129 characters", { ...ADD_INPUT, password: "a".repeat(129) }],
    ["not an object", "fake-input"],
  ])("refuses %s without calling the users module", async (_label, input) => {
    expect(await addRequester(input)).toEqual({ ok: false, message: INVALID_ADD });
    expect(mocks.createRequester).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["email-taken", "A user with that email already exists."],
    ["name-taken", "A user with that name already exists. Names are used to sign in, so each must be different."],
  ])("maps a %s refusal to a message and does not revalidate", async (reason, message) => {
    mocks.createRequester.mockResolvedValue({ ok: false, reason });

    expect(await addRequester(ADD_INPUT)).toEqual({ ok: false, message });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [true, "Couldn't set the password, so nothing was created."],
    [false, "Couldn't set the password. Delete the half-created user below and try again."],
  ])("reports a failed password setup (removed: %s) and logs only the message", async (removed, message) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createRequester.mockRejectedValue(new PasswordSetupError("fake adapter failure", removed));

    expect(await addRequester(ADD_INPUT)).toEqual({ ok: false, message });
    expect(log).toHaveBeenCalledWith("Add requester: password setup failed: fake adapter failure");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not password setup failures", async () => {
    mocks.createRequester.mockRejectedValue(new Error("database down"));

    await expect(addRequester(ADD_INPUT)).rejects.toThrow("database down");
  });

  it("never echoes the password in a result", async () => {
    mocks.createRequester.mockResolvedValue({ ok: false, reason: "email-taken" });

    const result = await addRequester(ADD_INPUT);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });
});

describe("resetRequesterPassword", () => {
  it("sets the password for the parsed user and revalidates the page", async () => {
    expect(await resetRequesterPassword(RESET_INPUT)).toEqual({ ok: true });
    expect(mocks.setRequesterPassword).toHaveBeenCalledWith(mocks.context, "fake-user-1", PASSWORD);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });

  it.each([
    ["an extra key", { ...RESET_INPUT, role: "admin" }],
    ["a missing user id", { password: PASSWORD }],
    ["an empty user id", { ...RESET_INPUT, userId: "" }],
    ["a user id that is not a string", { ...RESET_INPUT, userId: 42 }],
    ["a password of 11 characters", { ...RESET_INPUT, password: "a".repeat(11) }],
    ["a password of 129 characters", { ...RESET_INPUT, password: "a".repeat(129) }],
    ["a password that is not a string", { ...RESET_INPUT, password: 123456789012 }],
  ])("refuses %s without calling the users module", async (_label, input) => {
    expect(await resetRequesterPassword(input)).toEqual({ ok: false, message: INVALID_RESET });
    expect(mocks.setRequesterPassword).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

// The three actions that act on an existing user share one refusal mapping: missing user, or an admin.
describe.each([
  { name: "resetRequesterPassword", call: () => resetRequesterPassword(RESET_INPUT), upstream: mocks.setRequesterPassword },
  { name: "signOutRequester", call: () => signOutRequester(USER_INPUT), upstream: mocks.signOutUser },
  { name: "deleteRequesterAccount", call: () => deleteRequesterAccount(USER_INPUT), upstream: mocks.deleteRequester },
])("$name refusals", ({ call, upstream }) => {
  it.each([
    ["not-found", NOT_FOUND],
    ["not-requester", NOT_REQUESTER],
  ])("maps %s to a message and does not revalidate", async (reason, message) => {
    upstream.mockResolvedValueOnce({ ok: false, reason });

    expect(await call()).toEqual({ ok: false, message });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("signOutRequester", () => {
  it("signs the parsed user out and revalidates the page", async () => {
    expect(await signOutRequester(USER_INPUT)).toEqual({ ok: true });
    expect(mocks.signOutUser).toHaveBeenCalledWith(mocks.context, "fake-user-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });
});

describe("deleteRequesterAccount", () => {
  it("deletes the parsed user and revalidates the page", async () => {
    expect(await deleteRequesterAccount(USER_INPUT)).toEqual({ ok: true });
    expect(mocks.deleteRequester).toHaveBeenCalledWith(mocks.context, "fake-user-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });
});

describe("user id input", () => {
  it.each([
    ["signOutRequester", signOutRequester, mocks.signOutUser, "an extra key", { ...USER_INPUT, password: PASSWORD }],
    ["signOutRequester", signOutRequester, mocks.signOutUser, "a missing user id", {}],
    ["signOutRequester", signOutRequester, mocks.signOutUser, "a user id that is not a string", { userId: ["fake-user-1"] }],
    ["deleteRequesterAccount", deleteRequesterAccount, mocks.deleteRequester, "an extra key", { ...USER_INPUT, email: "fake@example.test" }],
    ["deleteRequesterAccount", deleteRequesterAccount, mocks.deleteRequester, "a missing user id", {}],
    ["deleteRequesterAccount", deleteRequesterAccount, mocks.deleteRequester, "a user id that is not a string", { userId: true }],
  ])("%s refuses %s without calling the users module", async (_name, action, upstream, _label, input) => {
    expect(await action(input)).toEqual({ ok: false, message: INVALID_USER });
    expect(upstream).not.toHaveBeenCalled();
  });
});

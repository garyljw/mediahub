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

describe.each(actions)("%s authorization", (_name, action, input) => {
  it("checks for the admin role", async () => {
    await action(input);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never touches the users module", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await action(input)).toEqual({ ok: false, message: DENIED });
    expect(mocks.createRequester).not.toHaveBeenCalled();
    expect(mocks.setRequesterPassword).not.toHaveBeenCalled();
    expect(mocks.signOutUser).not.toHaveBeenCalled();
    expect(mocks.deleteRequester).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never touches the users module", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    expect(await action(input)).toEqual({ ok: false, message: DENIED });
    expect(mocks.createRequester).not.toHaveBeenCalled();
    expect(mocks.setRequesterPassword).not.toHaveBeenCalled();
    expect(mocks.signOutUser).not.toHaveBeenCalled();
    expect(mocks.deleteRequester).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(action(input)).rejects.toThrow("database down");
    expect(mocks.createRequester).not.toHaveBeenCalled();
    expect(mocks.setRequesterPassword).not.toHaveBeenCalled();
    expect(mocks.signOutUser).not.toHaveBeenCalled();
    expect(mocks.deleteRequester).not.toHaveBeenCalled();
  });
});

describe("addRequester", () => {
  it("creates the requester with the parsed fields and revalidates the page", async () => {
    expect(await addRequester({ ...ADD_INPUT, email: "  Fake.Person@Example.TEST " })).toEqual({ ok: true });
    expect(mocks.createRequester).toHaveBeenCalledWith(mocks.context, {
      name: "Fake Person",
      email: "fake.person@example.test",
      password: PASSWORD,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });

  it("trims the name", async () => {
    await addRequester({ ...ADD_INPUT, name: "  Fake Person  " });
    expect(mocks.createRequester).toHaveBeenCalledWith(mocks.context, expect.objectContaining({ name: "Fake Person" }));
  });

  it.each([
    ["an extra key", { ...ADD_INPUT, role: "admin" }],
    ["a missing name", { email: ADD_INPUT.email, password: PASSWORD }],
    ["an empty name", { ...ADD_INPUT, name: "   " }],
    ["a name over 100 characters", { ...ADD_INPUT, name: "n".repeat(101) }],
    ["a bad email", { ...ADD_INPUT, email: "not-an-email" }],
    ["a password of 11 characters", { ...ADD_INPUT, password: "a".repeat(11) }],
    ["a password of 129 characters", { ...ADD_INPUT, password: "a".repeat(129) }],
    ["not an object", "fake-input"],
  ])("refuses %s without calling the users module", async (_label, input) => {
    expect(await addRequester(input)).toEqual({ ok: false, message: INVALID_ADD });
    expect(mocks.createRequester).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a taken name to a message and does not revalidate", async () => {
    mocks.createRequester.mockResolvedValue({ ok: false, reason: "name-taken" });

    expect(await addRequester(ADD_INPUT)).toEqual({
      ok: false,
      message: "A user with that name already exists. Names are used to sign in, so each must be different.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a name containing @ without calling the users module", async () => {
    expect(await addRequester({ ...ADD_INPUT, name: "fake@example.test" })).toEqual({ ok: false, message: INVALID_ADD });
    expect(mocks.createRequester).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps an existing email to a message and does not revalidate", async () => {
    mocks.createRequester.mockResolvedValue({ ok: false, reason: "email-taken" });

    expect(await addRequester(ADD_INPUT)).toEqual({ ok: false, message: "A user with that email already exists." });
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

  it("maps a missing user to a message", async () => {
    mocks.setRequesterPassword.mockResolvedValue({ ok: false, reason: "not-found" });
    expect(await resetRequesterPassword(RESET_INPUT)).toEqual({ ok: false, message: NOT_FOUND });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a non-requester to the Plex message", async () => {
    mocks.setRequesterPassword.mockResolvedValue({ ok: false, reason: "not-requester" });
    expect(await resetRequesterPassword(RESET_INPUT)).toEqual({ ok: false, message: NOT_REQUESTER });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("signOutRequester", () => {
  it("signs the parsed user out and revalidates the page", async () => {
    expect(await signOutRequester(USER_INPUT)).toEqual({ ok: true });
    expect(mocks.signOutUser).toHaveBeenCalledWith(mocks.context, "fake-user-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });

  it.each([
    ["an extra key", { ...USER_INPUT, password: PASSWORD }],
    ["a missing user id", {}],
    ["a user id that is not a string", { userId: ["fake-user-1"] }],
  ])("refuses %s without calling the users module", async (_label, input) => {
    expect(await signOutRequester(input)).toEqual({ ok: false, message: INVALID_USER });
    expect(mocks.signOutUser).not.toHaveBeenCalled();
  });

  it("maps a non-requester and a missing user to messages", async () => {
    mocks.signOutUser.mockResolvedValueOnce({ ok: false, reason: "not-requester" });
    expect(await signOutRequester(USER_INPUT)).toEqual({ ok: false, message: NOT_REQUESTER });

    mocks.signOutUser.mockResolvedValueOnce({ ok: false, reason: "not-found" });
    expect(await signOutRequester(USER_INPUT)).toEqual({ ok: false, message: NOT_FOUND });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteRequesterAccount", () => {
  it("deletes the parsed user and revalidates the page", async () => {
    expect(await deleteRequesterAccount(USER_INPUT)).toEqual({ ok: true });
    expect(mocks.deleteRequester).toHaveBeenCalledWith(mocks.context, "fake-user-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });

  it.each([
    ["an extra key", { ...USER_INPUT, email: "fake@example.test" }],
    ["a missing user id", {}],
    ["a user id that is not a string", { userId: true }],
  ])("refuses %s without calling the users module", async (_label, input) => {
    expect(await deleteRequesterAccount(input)).toEqual({ ok: false, message: INVALID_USER });
    expect(mocks.deleteRequester).not.toHaveBeenCalled();
  });

  it("maps a non-requester and a missing user to messages", async () => {
    mocks.deleteRequester.mockResolvedValueOnce({ ok: false, reason: "not-requester" });
    expect(await deleteRequesterAccount(USER_INPUT)).toEqual({ ok: false, message: NOT_REQUESTER });

    mocks.deleteRequester.mockResolvedValueOnce({ ok: false, reason: "not-found" });
    expect(await deleteRequesterAccount(USER_INPUT)).toEqual({ ok: false, message: NOT_FOUND });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

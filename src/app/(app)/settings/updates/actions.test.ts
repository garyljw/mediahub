import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requestUpdateCheck: vi.fn(),
  revalidatePath: vi.fn(),
}));

// AuthzError must be a real class: the action checks `instanceof AuthzError`.
vi.mock("@/server/authz", () => {
  class AuthzError extends Error {
    constructor(readonly status: 401 | 403) {
      super(status === 401 ? "unauthorized" : "forbidden");
      this.name = "AuthzError";
    }
  }
  return { AuthzError, requireRole: mocks.requireRole };
});
vi.mock("@/server/updater/app-view", () => ({ requestUpdateCheck: mocks.requestUpdateCheck }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { AuthzError } from "@/server/authz";
import { checkForUpdatesNow } from "./actions";

const DENIED = "You don't have permission to check for updates.";
const UNAVAILABLE = "Updates are only available when MediaHub is installed with the Windows installer.";
const FAILED = "Couldn't ask the updater to check.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.requestUpdateCheck.mockReturnValue("queued");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkForUpdatesNow authorization", () => {
  it("checks for the admin role", async () => {
    await checkForUpdatesNow();
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("denies a requester and never asks the updater", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));
    expect(await checkForUpdatesNow()).toEqual({ ok: false, message: DENIED });
    expect(mocks.requestUpdateCheck).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));
    await expect(checkForUpdatesNow()).rejects.toThrow("database down");
    expect(mocks.requestUpdateCheck).not.toHaveBeenCalled();
  });
});

describe("checkForUpdatesNow", () => {
  // Both outcomes count as success: an already-queued check is still the check the user asked for.
  it.each(["queued", "already-queued"])("treats a %s check as success and revalidates the page", async (outcome) => {
    mocks.requestUpdateCheck.mockReturnValue(outcome);

    expect(await checkForUpdatesNow()).toEqual({ ok: true, queued: true });
    expect(mocks.requestUpdateCheck).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/updates");
  });

  it("explains when updates are not available", async () => {
    mocks.requestUpdateCheck.mockReturnValue("unavailable");
    expect(await checkForUpdatesNow()).toEqual({ ok: false, message: UNAVAILABLE });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("gives a generic message when the request fails, and logs no path", async () => {
    const error = Object.assign(new Error("EACCES: permission denied, open '/secret/updates/requests/check-x'"), {
      code: "EACCES",
    });
    mocks.requestUpdateCheck.mockImplementation(() => {
      throw error;
    });
    expect(await checkForUpdatesNow()).toEqual({ ok: false, message: FAILED });
    expect(console.error).toHaveBeenCalledTimes(1);
    const logged = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(logged).toContain("EACCES");
    expect(logged).not.toContain("/secret");
  });
});

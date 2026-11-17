import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  savePhoneBackButton: vi.fn(),
  refresh: vi.fn(),
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

vi.mock("@/server/settings/phone-back-button", () => ({ savePhoneBackButton: mocks.savePhoneBackButton }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import { AuthzError } from "@/server/authz";
import { savePhoneBackButtonSetting } from "./actions";

const DENIED = "You don't have permission to change this setting.";
const INVALID = "Choose on or off.";

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
});

describe("authorization", () => {
  it("checks for the admin role", async () => {
    await savePhoneBackButtonSetting({ on: true });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  // A signed-out caller (401) gets the same AuthzError branch as a requester (403), so one status is enough.
  it("refuses a requester, never saves and does not refresh", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    expect(await savePhoneBackButtonSetting({ on: true })).toEqual({ ok: false, message: DENIED });
    expect(mocks.savePhoneBackButton).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(savePhoneBackButtonSetting({ on: true })).rejects.toThrow("database down");
    expect(mocks.savePhoneBackButton).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("savePhoneBackButtonSetting", () => {
  it("saves the switch, refreshes the layout and reports success", async () => {
    expect(await savePhoneBackButtonSetting({ on: true })).toEqual({ ok: true });
    expect(mocks.savePhoneBackButton).toHaveBeenCalledWith(true);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { on: "yes" }, { on: true, extra: 1 }])("refuses %j without saving", async (input) => {
    expect(await savePhoneBackButtonSetting(input)).toEqual({ ok: false, message: INVALID });
    expect(mocks.savePhoneBackButton).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

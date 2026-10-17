import "server-only";
import { describe, expect, it } from "vitest";
import { AuthzError, authzErrorResponse, createAuthz, type SessionUser } from "./authz";

const admin: SessionUser = { id: "u1", email: "admin@example.test", name: "Admin", role: "admin" };
const requester: SessionUser = { id: "u2", email: "req@example.test", name: "Req", role: "requester" };

function authzFor(user: SessionUser | null) {
  return createAuthz(async () => user);
}

async function expectAuthzError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AuthzError);
  expect((error as AuthzError).status).toBe(status);
}

describe("requireRole", () => {
  it("throws 401 when there is no session", async () => {
    await expectAuthzError(authzFor(null).requireRole("admin"), 401);
    await expectAuthzError(authzFor(null).requireRole("admin", "requester"), 401);
  });

  it("throws 403 when a requester calls requireRole('admin')", async () => {
    await expectAuthzError(authzFor(requester).requireRole("admin"), 403);
  });

  it("allows an admin through requireRole('admin')", async () => {
    const result = await authzFor(admin).requireRole("admin");
    expect(result).toEqual({ user: { id: "u1", email: admin.email, name: "Admin", role: "admin" } });
  });

  it("allows a requester through requireRole('admin', 'requester')", async () => {
    const result = await authzFor(requester).requireRole("admin", "requester");
    expect(result.user.role).toBe("requester");
  });

  it("treats an unknown or garbage role as forbidden, even when listed roles would allow it", async () => {
    const garbage: SessionUser = { ...requester, role: "superuser" };
    await expectAuthzError(authzFor(garbage).requireRole("admin", "requester"), 403);
    await expectAuthzError(authzFor({ ...requester, role: "" }).requireRole("requester"), 403);
    await expectAuthzError(authzFor({ ...requester, role: "Admin" }).requireRole("admin"), 403);
  });

  it("does not expose extra session fields", async () => {
    const withExtra = { ...admin, token: "secret" } as SessionUser & { token: string };
    const result = await authzFor(withExtra).requireRole("admin");
    expect(Object.keys(result.user).sort()).toEqual(["email", "id", "name", "role"]);
  });
});

describe("authzErrorResponse", () => {
  it("maps 401 and 403 to JSON error bodies", async () => {
    const r401 = authzErrorResponse(new AuthzError(401));
    expect(r401.status).toBe(401);
    expect(await r401.json()).toEqual({ error: "unauthorized" });

    const r403 = authzErrorResponse(new AuthzError(403));
    expect(r403.status).toBe(403);
    expect(await r403.json()).toEqual({ error: "forbidden" });
  });

  it("rethrows anything that is not an AuthzError", () => {
    const boom = new Error("boom");
    expect(() => authzErrorResponse(boom)).toThrow(boom);
  });
});

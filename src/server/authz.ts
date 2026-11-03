import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getAuth } from "./auth";
import { isRole, type Role } from "./roles";

export type { Role } from "./roles";

/** Session user as stored. `role` is unvalidated here; requireRole does the check. */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string | null;
};

/** A user who passed a role check. Only these fields leave authz. */
export type AuthorizedUser = { id: string; email: string; name: string; role: Role };

type AllowedRoles = [Role, ...Role[]];

export type SessionLookup = () => Promise<SessionUser | null>;

export class AuthzError extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? "unauthorized" : "forbidden");
    this.name = "AuthzError";
  }
}

/**
 * Builds getSession/requireRole around an injectable session lookup.
 * Production uses the Better Auth lookup below; tests pass a fake.
 */
export function createAuthz(lookup: SessionLookup) {
  async function getSession(): Promise<SessionUser | null> {
    return lookup();
  }

  // At least one role is required: an empty list would lock everyone out with no type error.
  async function requireRole(...roles: AllowedRoles): Promise<{ user: AuthorizedUser }> {
    const user = await lookup();
    if (!user) throw new AuthzError(401);
    // Unknown or garbage role values fail closed: they are never in `roles`.
    if (!isRole(user.role) || !roles.includes(user.role)) throw new AuthzError(403);
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  /**
   * For server components (pages). No session redirects to /login. A signed-in user whose role
   * is unknown or not allowed gets a 404, not a 403, so the page does not reveal it exists.
   */
  async function requirePageUser(...roles: AllowedRoles): Promise<AuthorizedUser> {
    // Same policy as requireRole; only the failure response differs.
    try {
      return (await requireRole(...roles)).user;
    } catch (error) {
      if (error instanceof AuthzError) {
        if (error.status === 401) redirect("/login");
        notFound();
      }
      throw error;
    }
  }

  return { getSession, requireRole, requirePageUser };
}

// cache() dedupes the lookup within one request, so the layout and the page share one DB query.
const lookupFromRequest = cache(async (): Promise<SessionUser | null> => {
  // Read headers first: during prerender this bails out before env() can run.
  const requestHeaders = await headers();
  // Better Auth checks the session expiry with `new Date()`, and better-sqlite3 answers synchronously, so
  // without this the clock is read in a render stage where Next forbids it (dev error "unstable value
  // `new Date()`", raised because partialPrefetching is on). connection() defers the rest to request time.
  await connection();
  // Never renew here: pages can't set cookies, so the DB expiry would move without the cookie.
  // SessionKeepAlive renews via /api/auth/get-session instead.
  const session = await getAuth().api.getSession({
    headers: requestHeaders,
    query: { disableRefresh: true },
  });
  if (!session) return null;
  const { id, email, name, role } = session.user;
  // name is nullable in the Better Auth schema; the UI only needs a string.
  // role is optional in the Better Auth type; a missing role is treated as unknown (fails closed).
  return { id, email, name: name ?? "", role: role ?? null };
});

const authz = createAuthz(lookupFromRequest);

export const getSession = authz.getSession;
export const requireRole = authz.requireRole;
export const requirePageUser = authz.requirePageUser;

/** Maps AuthzError to a JSON response for route handlers. Anything else is rethrown. */
export function authzErrorResponse(error: unknown): Response {
  if (error instanceof AuthzError) {
    return Response.json(
      { error: error.status === 401 ? "unauthorized" : "forbidden" },
      { status: error.status },
    );
  }
  throw error;
}

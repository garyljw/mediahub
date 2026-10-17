import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
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

  async function requireRole(...roles: Role[]): Promise<{ user: { id: string; email: string; name: string; role: Role } }> {
    const user = await lookup();
    if (!user) throw new AuthzError(401);
    // Unknown or garbage role values fail closed: they are never in `roles`.
    if (!isRole(user.role) || !roles.includes(user.role)) throw new AuthzError(403);
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  return { getSession, requireRole };
}

// cache() dedupes the lookup within one request, so the layout and the page share one DB query.
const lookupFromRequest = cache(async (): Promise<SessionUser | null> => {
  // Read headers first: during prerender this bails out before env() can run.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { id, email, name, role } = session.user;
  // name is nullable in the Better Auth schema; the UI only needs a string.
  // role is optional in the Better Auth type; a missing role is treated as unknown (fails closed).
  return { id, email, name: name ?? "", role: role ?? null };
});

const authz = createAuthz(lookupFromRequest);

export const getSession = authz.getSession;
export const requireRole = authz.requireRole;

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

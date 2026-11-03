import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { env } from "@/server/env";

// Optimistic first layer only: it checks that a session cookie is present and
// answers anonymous page visits with a real HTTP 307. It does not validate the
// session. Pages and layouts (src/app/(app)/layout.tsx) do the real check on the
// server, so this file can be bypassed without exposing any data.
//
// getSessionCookie reads Better Auth's cookie name, including the "__Secure-" prefix
// used on https. It only parses the Cookie header, so it does not touch the DB.

export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  // Built from the configured public URL, not request.url: behind a reverse proxy
  // request.url can show an internal host. Next rejects a relative Location here.
  return NextResponse.redirect(new URL("/login", env().BETTER_AUTH_URL), 307);
}

// Pages only. Route handlers do their own requireRole (they must return 401/403 JSON,
// not a redirect). Login and setup (exactly /login, /setup and their sub-paths), auth
// endpoints, Next internals and static files are excluded.
export const config = {
  matcher: ["/((?!api/|login(?:/|$)|setup(?:/|$)|_next/|favicon.ico|.*\\..*).*)"],
};

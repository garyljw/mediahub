"use client";

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Renews the session once per page load. Server-side session checks don't renew (pages can't set
 * cookies), so this request to Better Auth's own route handler moves the DB expiry and the cookie together.
 */
export function SessionKeepAlive() {
  useEffect(() => {
    // Best effort: a failure only means no renewal on this load.
    authClient.getSession().catch(() => {});
  }, []);
  return null;
}

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/server/authz";

// Reads the session per request. Block on the server so the redirect is a real HTTP redirect.
export const instant = false;

// Real protection lives here (server-side, per request), not in proxy/middleware.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return children;
}

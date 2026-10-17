import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/server/authz";
import { AppShell } from "@/components/app-shell/app-shell";

// Reads the session per request. Block on the server so the redirect is a real HTTP redirect.
export const instant = false;

// This layout check is UX only. Layouts don't re-render on client navigation, so every page
// must call requirePageUser itself. The real protection lives in the pages and route handlers.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const isAdmin = session.role === "admin";
  return (
    <AppShell user={{ name: session.name, email: session.email }} isAdmin={isAdmin}>
      {children}
    </AppShell>
  );
}

import type { ReactNode } from "react";
import { Brand } from "./brand";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";
import { SessionKeepAlive } from "./session-keep-alive";
import { UserMenu } from "./user-menu";

type Props = {
  user: { name: string; email: string };
  isAdmin: boolean;
  children: ReactNode;
};

// Server component: the shell markup. Only the interactive pieces are client components.
export function AppShell({ user, isAdmin, children }: Props) {
  return (
    <div className="min-h-screen">
      <SessionKeepAlive />
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center px-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <NavLinks isAdmin={isAdmin} />
        </div>
        <div className="border-t p-2">
          <UserMenu name={user.name} email={user.email} />
        </div>
      </aside>

      {/* Mobile top bar: hamburger opens the drawer */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background px-2 md:hidden">
        <div className="flex min-w-0 items-center gap-1">
          <MobileNav isAdmin={isAdmin} />
          <Brand />
        </div>
        <UserMenu name={user.name} email={user.email} />
      </header>

      <main className="px-4 py-6 md:ml-56 md:px-8">{children}</main>
    </div>
  );
}

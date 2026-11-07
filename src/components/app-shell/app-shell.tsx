import type { ReactNode } from "react";
import { Brand } from "./brand";
import { NavLinks } from "./nav-links";
import { SessionKeepAlive } from "./session-keep-alive";
import { TabBar } from "./tab-bar";
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
      {/* Desktop sidebar (lg and up) */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r bg-sidebar lg:flex">
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

      {/* Narrow top bar (below lg): just the brand. Navigation is the bottom tab bar. */}
      <header className="flex h-14 items-center border-b bg-background pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] lg:hidden">
        <Brand />
      </header>

      <main className="pb-[calc(5rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-6 lg:ml-56 lg:px-8 lg:py-6">
        {children}
      </main>

      <TabBar email={user.email} isAdmin={isAdmin} />
    </div>
  );
}

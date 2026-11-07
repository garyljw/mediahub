"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { signOut } from "@/app/(app)/actions";
import { cn } from "@/lib/utils";
import { isActive, tabBarItems, type NavItem } from "./nav";

type Props = {
  email: string;
  isAdmin: boolean;
};

// Bottom navigation for narrow screens (below lg). The desktop sidebar takes over at lg.
export function TabBar({ email, isAdmin }: Props) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { tabs, more } = tabBarItems(isAdmin);
  const moreActive = more.some((item) => isActive(pathname, item.href));

  function renderTab(item: NavItem) {
    const active = isActive(pathname, item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-center transition-colors",
          active ? "text-brand-to" : "text-muted-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
        <span className="text-[10px] leading-tight">{item.label}</span>
      </Link>
    );
  }

  return (
    <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-sidebar/90 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur lg:hidden"
      >
        {/* One column per tab plus More, so the bar never leaves an empty slot. */}
        <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
          {tabs.map(renderTab)}
          {/* SheetTrigger gives the button aria-haspopup and aria-expanded. It is a button, not a page, so no aria-current. */}
          <SheetTrigger
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-center transition-colors",
              moreActive ? "text-brand-to" : "text-muted-foreground",
            )}
          >
            <Ellipsis className="size-5" aria-hidden="true" />
            <span className="text-[10px] leading-tight">More</span>
          </SheetTrigger>
        </div>
      </nav>

      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-2 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>More</SheetTitle>
          <SheetDescription>Other sections and your account</SheetDescription>
        </SheetHeader>
        <nav aria-label="More sections" className="flex flex-col gap-1">
          {more.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand text-primary-foreground glow-brand"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Separator className="my-2" />
        <p className="truncate px-3 text-sm text-muted-foreground" title={email}>
          {email}
        </p>
        <Link
          href="/about"
          aria-current={isActive(pathname, "/about") ? "page" : undefined}
          onClick={() => setMoreOpen(false)}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors",
            isActive(pathname, "/about")
              ? "bg-brand text-primary-foreground glow-brand"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Info className="size-4" aria-hidden="true" />
          About
        </Link>
        <form action={signOut}>
          <Button type="submit" variant="ghost" className="w-full justify-start px-3 py-3">
            Sign out
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { isActive, navItemsFor, type NavItem } from "./nav";

type Props = {
  isAdmin: boolean;
  /** Called after a link is clicked, so the mobile drawer can close. */
  onNavigate?: () => void;
};

export function NavLinks({ isAdmin, onNavigate }: Props) {
  const pathname = usePathname();
  const items = navItemsFor(isAdmin);
  const mainItems = items.filter((item) => !item.adminOnly);
  const adminItems = items.filter((item) => item.adminOnly);

  function renderLink(item: NavItem) {
    const active = isActive(pathname, item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-brand text-primary-foreground glow-brand"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
        {item.label}
      </Link>
    );
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {mainItems.map(renderLink)}
      {adminItems.length > 0 && (
        <>
          <Separator className="my-2" />
          {adminItems.map(renderLink)}
        </>
      )}
    </nav>
  );
}

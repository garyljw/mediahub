import { CalendarDays, Download, Film, History, Home, Settings, Tv, type LucideIcon } from "lucide-react";

// Plain config shared by the server shell and client nav links. Must not import from src/server.
export type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/movies", label: "Movies", icon: Film },
  { href: "/tv", label: "TV", icon: Tv },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/queue", label: "Queue", icon: Download },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

/** Items this user may see. UX only: every page still runs requirePageUser on the server. */
export function navItemsFor(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly);
}

/** True for an exact match or a child route, so /movies/123 highlights Movies but /moviesx does not. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

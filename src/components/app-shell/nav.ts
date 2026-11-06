import { CalendarDays, Clapperboard, Download, History, Home, MonitorPlay, Settings, type LucideIcon } from "lucide-react";

// Plain config shared by the server shell and client nav links. Must not import from src/server.
export type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/focus/movies", label: "Movie Focus", icon: Clapperboard },
  { href: "/focus/tv", label: "TV Focus", icon: MonitorPlay },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/queue", label: "Queue", icon: Download },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

/** Items this user may see. UX only: every page still runs requirePageUser on the server. */
export function navItemsFor(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly);
}

// A movie or series page, e.g. /movies/123. Its back link goes to Home, so Home is the nav item it highlights.
const ITEM_PAGE = /^\/(movies|tv)\/[^/]+/;

/** True for an exact match or a child route, so /settings/users highlights Settings but /settingsx does not. Item pages highlight Home. */
export function isActive(pathname: string, href: string): boolean {
  if (ITEM_PAGE.test(pathname)) return href === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

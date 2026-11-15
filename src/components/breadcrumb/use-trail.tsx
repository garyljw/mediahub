"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isPlainClick } from "@/components/home/return-place";
import { NAV_ITEMS } from "@/components/app-shell/nav";
import { startTrail, writeStep } from "./trail";

/**
 * Keeps the breadcrumb trail's two inputs up to date. Mounted once, in the app shell:
 * - opening a nav page starts a new trail at that page;
 * - every plain click on a link within the app records where it went from and to, at click time, so the page that
 *   opens can tell it was reached by a click from the trail's last page (and not from the address bar or a reload).
 */
export function useTrail(): void {
  const pathname = usePathname();

  useEffect(() => {
    const item = NAV_ITEMS.find((entry) => entry.href === pathname);
    if (item) startTrail({ path: item.href, label: item.label });
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // A click that opens a new tab leaves this page open, so it is not a step from here.
      if (event.defaultPrevented || !isPlainClick(event)) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (link === null || (link.target !== "" && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      writeStep({ from: window.location.pathname, to: url.pathname });
    };
    // Capture, so the record is written before any handler can stop the event or the navigation starts.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}

/** Mounts useTrail. The app shell is a server component, so it renders this instead of calling the hook. */
export function TrailTracker(): null {
  useTrail();
  return null;
}

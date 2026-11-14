"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { backTarget, isPlainClick, readBackFrom, type BackFrom } from "@/components/home/return-place";

/**
 * The back link on a movie or series page (and a Popular preview). Server and first render give "← Home". After mount it reads the list the
 * user came from: when that list opened this title, the link goes back in history to it, so the list keeps its place.
 * Otherwise it stays a link to Home. It is a real link, so middle-click and new tabs still work.
 */
export function BackLink({ fallback }: { fallback?: { href: string; label: string } } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [stored, setStored] = useState<BackFrom | null>(null);

  // Read after mount, not during render: storage isn't there on the server, so the first render must not depend on it.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setStored(readBackFrom());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const found = backTarget(stored, pathname);
  // Not opened from a list: link to the page's own fallback (a Popular preview goes to Popular), else to Home.
  const target = found.mode === "link" && fallback ? { mode: "link" as const, ...fallback } : found;

  return (
    <Link
      href={target.mode === "back" ? target.list : target.href}
      onClick={(event) => {
        if (target.mode !== "back" || !isPlainClick(event)) return;
        event.preventDefault();
        router.back();
      }}
      className="text-sm text-muted-foreground hover:underline"
    >
      ← {target.label}
    </Link>
  );
}

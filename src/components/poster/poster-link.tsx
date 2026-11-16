import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Wraps a poster thumbnail in a link to the title's page. Keyboard and screen reader users reach the same page
 * through the title link beside it, so this one is left out of the tab order and hidden from assistive tech.
 * With no href the poster is shown as it is.
 */
export function PosterLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (href === null) return <>{children}</>;
  return (
    <Link
      href={href}
      tabIndex={-1}
      aria-hidden="true"
      className="shrink-0 rounded focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}

// Server-rendered pieces of the movie and series pages' Details card. No "use client": both pages are server components.
import type { ReactNode } from "react";

/** One label and value in the details grid. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * The external site links under the details grid. Entries with a null url are left out, and nothing renders when all
 * are null. The pages build each url from an id the mapper already checked.
 */
export function ExternalLinks({ links }: { links: { label: string; url: string | null }[] }) {
  const shown = links.filter((link): link is { label: string; url: string } => link.url !== null);
  if (shown.length === 0) return null;

  return (
    <p className="flex flex-wrap gap-4 text-sm">
      {shown.map((link) => (
        <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {link.label}
        </a>
      ))}
    </p>
  );
}

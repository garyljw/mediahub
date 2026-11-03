// Plain icon for the monitored flag. No "use client", so the server page and the client controls can both import it.
import { Bookmark, BookmarkCheck } from "lucide-react";

export function MonitoredIcon({ monitored }: { monitored: boolean }) {
  return monitored ? (
    <>
      <BookmarkCheck aria-hidden className="inline size-4 text-primary" />
      <span className="sr-only">Monitored</span>
    </>
  ) : (
    <>
      <Bookmark aria-hidden className="inline size-4 text-muted-foreground/60" />
      <span className="sr-only">Unmonitored</span>
    </>
  );
}

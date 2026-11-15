// A server component (no "use client"), shared by the series page and the episode page.
import { Badge } from "@/components/ui/badge";
import { WATCHED_CLASS, WATCHED_LABEL, type WatchedState } from "@/components/home/home-items";

/** The Plex watched badge for one episode or season, or a muted dash when Plex has no state for it. */
export function WatchedBadge({ state }: { state: WatchedState | undefined }) {
  if (state === undefined) return <span className="text-muted-foreground">—</span>;
  return <Badge className={WATCHED_CLASS[state]}>{WATCHED_LABEL[state]}</Badge>;
}

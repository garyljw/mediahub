"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SELECT_CLASS } from "@/components/library/table-parts";
import {
  PROTOCOL_FILTERS,
  filterReleases,
  parseProtocolFilter,
  releaseCountLine,
  releaseDetails,
  type GrabResult,
  type ProtocolFilter,
  type ReleaseSearchResult,
} from "@/components/library/release";

/**
 * Lists one app's interactive search results and sends the chosen one to its download client. Used for movies and
 * for TV seasons and episodes. The caller passes the search and the grab as functions, so this stays app-neutral.
 * Mounted only while open. The search starts once on mount, and is repeated only by "Search again".
 */
export function ReleaseDialog({
  subject,
  search,
  grab,
  onClose,
  onGrabbed,
}: {
  /** What the search is for, shown in the heading: a movie title, or "Breaking Bad · Season 2". */
  subject: string;
  search: () => Promise<ReleaseSearchResult>;
  grab: (token: string) => Promise<GrabResult>;
  onClose: () => void;
  onGrabbed: (title: string) => void;
}) {
  // null while the search is running. Each attempt number starts one search.
  const [outcome, setOutcome] = useState<ReleaseSearchResult | null>(null);
  const [attempt, setAttempt] = useState(1);
  // The last attempt that was started. A ref, so React's double effect run in development starts one search.
  const startedAttempt = useRef(0);
  const [searching, startSearch] = useTransition();
  const [grabbing, startGrab] = useTransition();
  const [grabError, setGrabError] = useState<string | null>(null);
  // Kept across "Search again", so a fresh search shows the same kind of releases.
  const [protocol, setProtocol] = useState<ProtocolFilter>("all");

  useEffect(() => {
    if (startedAttempt.current >= attempt) return;
    startedAttempt.current = attempt;
    startSearch(async () => {
      try {
        setOutcome(await search());
      } catch {
        // The request never got an answer (connection lost, server restarted), so say so in the dialog.
        setOutcome({ ok: false, error: "Couldn't reach MediaHub. Check your connection and try again." });
      }
    });
  }, [attempt, search]);

  function searchAgain() {
    setOutcome(null);
    setGrabError(null);
    setAttempt((current) => current + 1);
  }

  function grabRelease(token: string) {
    setGrabError(null);
    startGrab(async () => {
      try {
        const result = await grab(token);
        if (result.ok) onGrabbed(result.title);
        else setGrabError(result.error);
      } catch {
        setGrabError("Couldn't reach MediaHub. Check your connection and try again.");
      }
    });
  }

  const visible = outcome?.ok ? filterReleases(outcome.releases, protocol) : [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Searching is read-only, so closing is fine. Don't close during a grab, so its outcome is never lost.
        if (!open && !grabbing) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pick a release for {subject}</DialogTitle>
          {/* Live, so a screen reader hears the new count when the protocol filter changes. */}
          <DialogDescription aria-live="polite">
            {outcome?.ok
              ? releaseCountLine(visible.length, outcome.totals[protocol], protocol)
              : "Choose a release to send to the download client."}
          </DialogDescription>
        </DialogHeader>

        {outcome === null && (
          <p role="status" aria-busy={searching} className="py-6 text-center text-sm text-muted-foreground">
            Searching indexers… this can take a minute.
          </p>
        )}

        {outcome !== null && !outcome.ok && (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive">
              {outcome.error}
            </p>
            <Button variant="outline" size="sm" onClick={searchAgain}>
              Search again
            </Button>
          </div>
        )}

        {outcome !== null && outcome.ok && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {/* Results expire after 25 minutes, so a fresh search must be one click away. */}
              <Button variant="outline" size="sm" onClick={searchAgain} disabled={grabbing}>
                Search again
              </Button>
              {/* Always shown, even with no results: the filter is kept across searches, so it must stay changeable. */}
              <select
                aria-label="Protocol"
                value={protocol}
                onChange={(e) => setProtocol(parseProtocolFilter(e.target.value))}
                className={SELECT_CLASS}
              >
                {PROTOCOL_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {grabError && (
                <p role="alert" className="text-sm text-destructive">
                  {grabError}
                </p>
              )}
            </div>
            {visible.length > 0 && (
              // Two lines per release instead of a wide table, so the dialog stays the same size as Add movie.
              <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border">
                {visible.map((release, index) => {
                  const { token } = release;
                  const extras = [...release.customFormats, ...release.languages];
                  return (
                    // Rows without a token (the app won't allow the grab) fall back to their position in the shown list.
                    // They hold no state, so a remount when the filter changes is harmless.
                    <li key={token ?? `row-${index}`} className="flex items-start gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="break-words font-medium">{release.title}</div>
                        <div className="break-words text-xs text-muted-foreground tabular-nums">
                          {releaseDetails(release).join(" · ")}
                        </div>
                        {extras.length > 0 && (
                          <div className="break-words text-xs text-muted-foreground">{extras.join(", ")}</div>
                        )}
                        {!release.approved && release.rejections.length > 0 && (
                          <ul className="mt-1 list-disc pl-4 text-xs text-destructive">
                            {release.rejections.map((reason, reasonIndex) => (
                              <li key={reasonIndex}>{reason}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={release.approved ? "default" : "outline"}
                        className="shrink-0"
                        aria-label={`Grab ${release.title}`}
                        disabled={token === null || grabbing}
                        aria-busy={grabbing}
                        onClick={() => token !== null && grabRelease(token)}
                      >
                        Grab
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

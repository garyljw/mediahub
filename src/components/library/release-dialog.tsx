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
import { formatCount } from "@/components/library/format";
import {
  PACK_FILTERS,
  PROTOCOL_FILTERS,
  RELEASE_SORTS,
  filterReleases,
  HIDE_NOT_IN_PROFILE_KEY,
  PACK_CHOICE_KEY,
  SORT_CHOICE_KEY,
  parsePackFilter,
  parseReleaseSort,
  protocolChoiceKey,
  parseProtocolFilter,
  readChoice,
  releaseCountLine,
  releaseDetails,
  releaseTotal,
  sortReleases,
  writeChoice,
  type GrabResult,
  type PackFilter,
  type ProtocolFilter,
  type ReleaseSearchResult,
  type ReleaseSort,
} from "@/components/library/release";

/**
 * Lists one app's interactive search results and sends the chosen one to its download client. Used for movies and
 * for TV seasons and episodes. The caller passes the search and the grab as functions, so this stays app-neutral.
 * Mounted only while open. The search starts once on mount, and is repeated only by "Search again".
 * The protocol choice is remembered per kind, and the season pack choice is remembered for seasons.
 */
export function ReleaseDialog({
  subject,
  kind,
  search,
  grab,
  onClose,
  onGrabbed,
}: {
  /** What the search is for, shown in the heading: a movie title, or "Breaking Bad · Season 2". */
  subject: string;
  kind: "movie" | "season" | "episode";
  search: () => Promise<ReleaseSearchResult>;
  grab: (token: string, options: { replaceExisting: boolean }) => Promise<GrabResult>;
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
  // Kept across "Search again", so a fresh search shows the same kind of releases. Also remembered across dialogs.
  const [protocol, setProtocol] = useState<ProtocolFilter>(() => parseProtocolFilter(readChoice(protocolChoiceKey(kind))));
  // Only seasons have the pack choice. Movies and episodes always show every release.
  const [pack, setPack] = useState<PackFilter>(() =>
    kind === "season" ? parsePackFilter(readChoice(PACK_CHOICE_KEY)) : "all",
  );
  const [sort, setSort] = useState<ReleaseSort>(() => parseReleaseSort(readChoice(SORT_CHOICE_KEY)));
  // On by default. Only an explicit "false" from an earlier untick turns it off.
  const [hideNotInProfile, setHideNotInProfile] = useState(() => readChoice(HIDE_NOT_IN_PROFILE_KEY) !== "false");
  // Off every time the dialog opens: replacing a file is a deliberate choice for one grab, so it is not remembered.
  const [replaceExisting, setReplaceExisting] = useState(false);

  function changeProtocol(value: string) {
    const next = parseProtocolFilter(value);
    setProtocol(next);
    writeChoice(protocolChoiceKey(kind), next);
  }

  function changePack(value: string) {
    const next = parsePackFilter(value);
    setPack(next);
    writeChoice(PACK_CHOICE_KEY, next);
  }

  function changeSort(value: string) {
    const next = parseReleaseSort(value);
    setSort(next);
    writeChoice(SORT_CHOICE_KEY, next);
  }

  function changeHideNotInProfile(checked: boolean) {
    setHideNotInProfile(checked);
    writeChoice(HIDE_NOT_IN_PROFILE_KEY, checked ? "true" : "false");
  }

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
        const result = await grab(token, { replaceExisting });
        if (result.ok) onGrabbed(result.title);
        else setGrabError(result.error);
      } catch {
        setGrabError("Couldn't reach MediaHub. Check your connection and try again.");
      }
    });
  }

  // Rows the protocol and pack filters let through, before and after the hide box.
  const matching = outcome?.ok ? filterReleases(outcome.releases, protocol, pack) : [];
  const visible = sortReleases(hideNotInProfile ? matching.filter((r) => !r.notInProfile) : matching, sort);
  const hiddenCount = matching.length - visible.length;
  // No packs match, but other releases do. The count line already says so; offer a one-off switch to show them.
  const packsMissing =
    kind === "season" &&
    pack === "packs" &&
    outcome?.ok === true &&
    visible.length === 0 &&
    filterReleases(outcome.releases, protocol, "all", hideNotInProfile).length > 0;

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
              ? // The server's totals count the hidden rows too, so take away the ones the box hid.
                releaseCountLine(visible.length, releaseTotal(outcome.totals, protocol, pack) - hiddenCount, protocol, pack)
              : "Choose a release to send to the download client."}
          </DialogDescription>
        </DialogHeader>

        {outcome === null && (
          <div role="status" aria-busy={searching} className="flex flex-col gap-4 py-2">
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 rounded-full bg-brand animate-marquee motion-reduce:w-full" />
            </div>
            <p className="text-center text-sm text-muted-foreground">Searching indexers… this can take a minute.</p>
            {/* Placeholder rows in the same list style as the results. Decorative, so hidden from screen readers. */}
            <ul className="divide-y rounded-md border">
              {Array.from({ length: 4 }, (_, index) => (
                <li key={index} aria-hidden="true" className="flex flex-col gap-2 px-3 py-3">
                  <div className="h-4 w-3/4 rounded skeleton" />
                  <div className="h-3 w-1/2 rounded skeleton" />
                </li>
              ))}
            </ul>
          </div>
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
                onChange={(e) => changeProtocol(e.target.value)}
                className={SELECT_CLASS}
              >
                {PROTOCOL_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {kind === "season" && (
                <select
                  aria-label="Season packs"
                  value={pack}
                  onChange={(e) => changePack(e.target.value)}
                  className={SELECT_CLASS}
                >
                  {PACK_FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label="Sort"
                value={sort}
                onChange={(e) => changeSort(e.target.value)}
                className={SELECT_CLASS}
              >
                {RELEASE_SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hideNotInProfile}
                  onChange={(e) => changeHideNotInProfile(e.target.checked)}
                />
                Hide qualities not in profile
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
                Replace existing file
              </label>
              {grabError && (
                <p role="alert" className="text-sm text-destructive">
                  {grabError}
                </p>
              )}
            </div>
            {replaceExisting && (
              <p className="text-xs text-muted-foreground">
                If this download can&apos;t be imported because it isn&apos;t an upgrade, MediaHub imports it anyway and the existing file is replaced.
              </p>
            )}
            {hiddenCount > 0 && (
              <p className="text-xs text-muted-foreground">{formatCount(hiddenCount)} hidden: quality not in profile.</p>
            )}
            {packsMissing && (
              <div>
                {/* Only for this dialog: the remembered choice stays on season packs. */}
                <Button variant="outline" size="sm" onClick={() => setPack("all")}>
                  Show all releases
                </Button>
              </div>
            )}
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

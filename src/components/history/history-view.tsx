"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState, useTransition, type HTMLAttributes } from "react";
import { markHistoryFailed } from "@/app/(app)/history/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Poster } from "@/components/poster/poster";
import { usePosterPreview } from "@/components/poster/use-poster-preview";
import { rememberOpenedFrom } from "@/components/home/return-place";
import { toggleOnClick, CELL, HEAD, SELECT_CLASS } from "@/components/library/table-parts";
import type { HistoryDetails, HistoryEntry } from "@/server/merge/history";
import {
  HISTORY_EVENT_FILTERS,
  HISTORY_STEP,
  historyHref,
  setHistoryType,
  toggleHistoryEvent,
  type HistoryParams,
  type HistoryType,
} from "./history-params";
import { HISTORY_EVENT_CLASS, HISTORY_EVENT_LABEL } from "./history-status";

/** The labelled details a row can expand to show. Rows with no value for a field leave it out. */
function DetailList({ details }: { details: HistoryDetails }) {
  const rows: [string, string | null][] = [
    ["Release", details.sourceTitle],
    ["Indexer", details.indexer],
    ["Download client", details.downloadClient],
    ["Release group", details.releaseGroup],
    ["Size", details.size],
    ["Message", details.message],
    ["Reason", details.reason],
  ];
  const shown = rows.filter((row): row is [string, string] => row[1] !== null);
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">No more details.</p>;
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One history event on narrow screens: the title and facts (all wrapping), the expand button, and Mark as failed. */
function HistoryCard({
  entry,
  previewHandlers,
  isOpen,
  canMarkFailed,
  onToggle,
  onMarkFailed,
}: {
  entry: HistoryEntry;
  /** The poster hover preview's handlers (mouse only), as on the table rows. */
  previewHandlers: HTMLAttributes<HTMLLIElement>;
  isOpen: boolean;
  canMarkFailed: boolean;
  onToggle: () => void;
  onMarkFailed: (entry: HistoryEntry) => void;
}) {
  const detailsId = `history-card-details-${entry.key}`;
  return (
    <li className="cursor-pointer rounded-xl border bg-card p-3" {...previewHandlers} onClick={toggleOnClick(onToggle)}>
      <div className="flex gap-3">
        <Poster src={entry.posterSrc} />
        <div className="flex min-w-0 flex-1 items-start gap-2" data-poster-anchor>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-words font-medium">
                {entry.href !== null ? (
                  <Link href={entry.href} className="hover:underline">
                    {entry.title}
                  </Link>
                ) : (
                  entry.title
                )}
              </span>
              <Badge variant="outline" className="shrink-0">
                {entry.kind === "movie" ? "Movie" : "TV"}
              </Badge>
            </div>
            {entry.detail !== "" && <p className="break-words text-xs text-muted-foreground">{entry.detail}</p>}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Badge className={HISTORY_EVENT_CLASS[entry.event]}>{HISTORY_EVENT_LABEL[entry.event]}</Badge>
              <span className="whitespace-nowrap">{entry.quality ?? "—"}</span>
              <span className="whitespace-nowrap text-muted-foreground">{entry.when}</span>
            </div>
            {canMarkFailed && entry.canMarkFailed && (
              <Button variant="outline" size="sm" className="mt-1" onClick={() => onMarkFailed(entry)}>
                Mark as failed
              </Button>
            )}
          </div>
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={detailsId}
            aria-label={`${isOpen ? "Hide" : "Show"} details for ${entry.title}`}
            onClick={onToggle}
            className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
          >
            {isOpen ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      {isOpen && (
        <div id={detailsId} data-card-details className="mt-3 cursor-auto border-t pt-3">
          <DetailList details={entry.details} />
        </div>
      )}
    </li>
  );
}

/**
 * The History page's interactive part: the filters (kept in the URL, so each change loads the page again on the
 * server), the table with expandable rows, and the admin's Mark as failed dialog. Entries arrive already built by the
 * server, so no time is formatted in the browser.
 */
export function HistoryView({
  entries,
  params,
  hasMore,
  canMarkFailed,
  alerts,
}: {
  entries: HistoryEntry[];
  params: HistoryParams;
  hasMore: boolean;
  /** True for an admin. Only admins see the actions column and can mark a grabbed item as failed. */
  canMarkFailed: boolean;
  alerts: string[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [marking, setMarking] = useState<HistoryEntry | null>(null);
  // The last item the dialog was opened for. Kept after close, so the text doesn't change during the close animation.
  const [shownTarget, setShownTarget] = useState<HistoryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const posterPreview = usePosterPreview<string>();

  // The desktop table's columns: When, Poster and Title. The expanded details row spans all of them.
  const columnCount = 3;
  const appName = shownTarget?.app === "sonarr" ? "Sonarr" : "Radarr";
  const release = shownTarget?.details.sourceTitle ?? shownTarget?.title ?? "";
  // The preview belongs to a row. Hide it when that row is gone (for example after a filter change).
  const previewVisible =
    posterPreview.activeKey !== null && entries.some((entry) => entry.key === posterPreview.activeKey);

  function go(next: HistoryParams) {
    router.push(historyHref(next));
  }

  function toggleExpanded(key: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function closeMarking() {
    setMarking(null);
    setError(null);
  }

  function confirmMarking() {
    if (marking === null) return;
    const target = marking;
    setError(null);
    startTransition(async () => {
      const result = await markHistoryFailed({ app: target.app, historyId: target.historyId });
      if (result.ok) closeMarking();
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-4" onClick={rememberOpenedFrom("/history")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <select
          aria-label="Type"
          value={params.type}
          onChange={(event) => go(setHistoryType(params, event.target.value as HistoryType))}
          className={SELECT_CLASS}
        >
          <option value="all">All</option>
          <option value="movies">Movies</option>
          <option value="tv">TV</option>
        </select>

        <fieldset className="flex flex-wrap items-center gap-3 text-sm">
          <legend className="sr-only">Events</legend>
          {HISTORY_EVENT_FILTERS.map((event) => (
            <label key={event} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={params.events.includes(event)}
                onChange={() => go(toggleHistoryEvent(params, event))}
                className="size-4 accent-primary"
              />
              {HISTORY_EVENT_LABEL[event]}
            </label>
          ))}
        </fieldset>
      </div>

      {alerts.map((message) => (
        <p key={message} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ))}

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No history matches these filters.</p>
      ) : (
        <>
        <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>When</TableHead>
              <TableHead className={HEAD}>
                <span className="sr-only">Poster</span>
              </TableHead>
              <TableHead className={HEAD}>Title</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const isOpen = expanded.has(entry.key);
              const detailsId = `history-details-${entry.key}`;
              return (
                <Fragment key={entry.key}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={toggleOnClick(() => toggleExpanded(entry.key))}
                  >
                    <TableCell className={`${CELL} align-top whitespace-nowrap text-muted-foreground`}>{entry.when}</TableCell>
                    <TableCell className={`${CELL} align-top`}>
                      <Poster src={entry.posterSrc} size="lg" />
                    </TableCell>
                    {/* Everything about the event sits beside the poster, so on a wide screen nothing is far from the
                        title. The synopsis is in the row, so the table needs no hover preview. */}
                    <TableCell className={`${CELL} max-w-0 w-full min-w-48 align-top`}>
                      <div className="flex min-w-0 items-start gap-2">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={detailsId}
                          aria-label={`${isOpen ? "Hide" : "Show"} details for ${entry.title}`}
                          onClick={() => toggleExpanded(entry.key)}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          {isOpen ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium" title={entry.title}>
                            {entry.href !== null ? (
                              <Link href={entry.href} className="hover:underline">
                                {entry.title}
                              </Link>
                            ) : (
                              entry.title
                            )}
                          </div>
                          {entry.detail !== "" && <p className="truncate text-xs text-muted-foreground">{entry.detail}</p>}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                            <Badge variant="outline">{entry.kind === "movie" ? "Movie" : "TV"}</Badge>
                            <Badge className={HISTORY_EVENT_CLASS[entry.event]}>{HISTORY_EVENT_LABEL[entry.event]}</Badge>
                            {entry.quality !== null && <span className="text-muted-foreground">{entry.quality}</span>}
                            {canMarkFailed && entry.canMarkFailed && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7"
                                onClick={() => {
                                  setShownTarget(entry);
                                  setMarking(entry);
                                }}
                              >
                                Mark as failed
                              </Button>
                            )}
                          </div>
                          {entry.peek !== null && entry.peek.overview !== "" && (
                            <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{entry.peek.overview}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow id={detailsId}>
                      <TableCell colSpan={columnCount} className="bg-muted/30 px-4 py-2">
                        <DetailList details={entry.details} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
        </div>
        <ul className="space-y-2 lg:hidden">
          {entries.map((entry) => (
            <HistoryCard
              key={entry.key}
              previewHandlers={posterPreview.rowHandlers(entry.key, entry.posterSrc, {
                title: entry.title,
                kind: entry.kind === "movie" ? "movie" : "series",
                peek: entry.peek,
              })}
              entry={entry}
              isOpen={expanded.has(entry.key)}
              canMarkFailed={canMarkFailed}
              onToggle={() => toggleExpanded(entry.key)}
              onMarkFailed={(target) => {
                setShownTarget(target);
                setMarking(target);
              }}
            />
          ))}
        </ul>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          Showing {entries.length} {entries.length === 1 ? "event" : "events"}
        </p>
        {hasMore && (
          <Button asChild variant="outline" size="sm">
            <Link href={historyHref({ ...params, limit: params.limit + HISTORY_STEP })}>Show more</Link>
          </Button>
        )}
      </div>

      <Dialog
        open={marking !== null}
        onOpenChange={(open) => {
          // Don't close while the change is in flight, so its outcome is never shown to nobody.
          if (!open && !pending) closeMarking();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as failed?</DialogTitle>
            <DialogDescription>
              This marks &quot;{release}&quot; as failed in {appName}.
            </DialogDescription>
          </DialogHeader>
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeMarking} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmMarking} disabled={pending}>
              Mark as failed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {previewVisible && posterPreview.preview}
    </div>
  );
}

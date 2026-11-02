"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Poster } from "@/components/poster/poster";
import { usePosterPreview } from "@/components/poster/use-poster-preview";
import { ACTIVITY_CLASS, ACTIVITY_ICON } from "@/components/library/activity-cell";
import { showsEtaFor, showsProgressFor, stateLabel } from "@/components/library/activity";
import { CELL, HEAD } from "@/components/library/table-parts";
import { formatEta, formatSize } from "@/components/library/format";
import {
  keepLastKnown,
  NEVER_LOADED,
  visibleQueue,
  type LastKnownRows,
  type QueueFailures,
  type QueueRow,
  type QueueRowDetails,
} from "./queue-rows";
import { useQueueAutoRefresh } from "./use-auto-refresh";

/** The labelled download facts an admin can expand a row to see. Rows with no value for a field leave it out. */
function DetailList({ row, details }: { row: QueueRow; details: QueueRowDetails }) {
  const rows: [string, string | null][] = [
    ["Release", details.releaseTitle],
    ["Indexer", details.indexer],
    ["Download client", details.downloadClient],
    ["Protocol", details.protocol],
  ];
  const shown = rows.filter((entry): entry is [string, string] => entry[1] !== null);
  return (
    <div className="space-y-2">
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No more details.</p>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          {shown.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {row.messages.length > 0 && (
        <ul className="list-inside list-disc text-sm text-amber-800 dark:text-amber-300">
          {row.messages.map((message, index) => (
            <li key={index} className="break-words">
              {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The Queue page's table. Entries arrive already built by the server, so no time is formatted in the browser. It
 * refreshes the server data every few seconds while the tab is visible. A side whose request failed keeps its last
 * known rows, with an alert saying so. Admins see the release columns and can expand a row for its download facts and
 * messages. Requesters see the status columns only.
 */
export function QueueView({
  rows,
  failed,
  showDetails,
}: {
  /** The fresh rows from the server, for both apps. Rows of an app that failed this time are ignored. */
  rows: QueueRow[];
  failed: QueueFailures;
  /** True for an admin: the Quality and Size columns, and the expandable rows. */
  showDetails: boolean;
}) {
  useQueueAutoRefresh();

  // The rows kept from earlier refreshes. Updated during render when the props change, the React pattern for
  // "storing information from previous renders". React re-runs this render straight away with the new value.
  const [seen, setSeen] = useState({ rows, failed });
  const [known, setKnown] = useState<LastKnownRows>(() => keepLastKnown(NEVER_LOADED, rows, failed));
  if (seen.rows !== rows || seen.failed !== failed) {
    setSeen({ rows, failed });
    setKnown(keepLastKnown(known, rows, failed));
  }
  const visible = visibleQueue(known, failed);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const posterPreview = usePosterPreview<string>();

  // The preview belongs to a row. Hide it when that row is gone (for example after a refresh).
  const previewVisible =
    posterPreview.activeKey !== null && visible.rows.some((row) => row.key === posterPreview.activeKey);
  const columnCount = showDetails ? 7 : 5;

  function toggleExpanded(key: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {visible.alerts.map((message) => (
        <p key={message} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ))}

      {visible.rows.length === 0 ? (
        visible.alerts.length === 0 && <p className="text-sm text-muted-foreground">Nothing in the queue.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>
                <span className="sr-only">Poster</span>
              </TableHead>
              <TableHead className={HEAD}>Title</TableHead>
              <TableHead className={HEAD}>Status</TableHead>
              <TableHead className={HEAD}>Progress</TableHead>
              <TableHead className={HEAD}>Time left</TableHead>
              {showDetails && <TableHead className={HEAD}>Quality</TableHead>}
              {showDetails && <TableHead className={HEAD}>Size</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.rows.map((row) => {
              const isOpen = expanded.has(row.key);
              const detailsId = `queue-details-${row.key}`;
              const Icon = ACTIVITY_ICON[row.state];
              return (
                <Fragment key={row.key}>
                  <TableRow {...posterPreview.rowHandlers(row.key, row.posterSrc)}>
                    <TableCell className={CELL}>
                      <Poster src={row.posterSrc} />
                    </TableCell>
                    <TableCell className={`${CELL} max-w-0 w-full`} data-poster-anchor>
                      <div className="flex min-w-0 items-center gap-2">
                        {showDetails && row.details !== null && (
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={detailsId}
                            aria-label={`${isOpen ? "Hide" : "Show"} details for ${row.title}`}
                            onClick={() => toggleExpanded(row.key)}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            {isOpen ? (
                              <ChevronDown className="size-4" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="size-4" aria-hidden="true" />
                            )}
                          </button>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium" title={row.title}>
                              {row.href !== null ? (
                                <Link href={row.href} className="hover:underline">
                                  {row.title}
                                </Link>
                              ) : (
                                row.title
                              )}
                            </span>
                            <Badge variant="outline" className="shrink-0">
                              {row.kind === "movie" ? "Movie" : "TV"}
                            </Badge>
                          </div>
                          {row.detail !== "" && <p className="truncate text-xs text-muted-foreground">{row.detail}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={CELL}>
                      <span className={`flex min-w-0 items-center gap-1.5 whitespace-nowrap ${ACTIVITY_CLASS[row.severity]}`}>
                        <Icon aria-hidden className="size-3.5 shrink-0" />
                        {stateLabel(row.state)}
                      </span>
                    </TableCell>
                    <TableCell className={`${CELL} whitespace-nowrap`}>
                      {showsProgressFor(row.state) && row.progress !== null ? `${row.progress}%` : "—"}
                    </TableCell>
                    <TableCell className={`${CELL} whitespace-nowrap`}>
                      {showsEtaFor(row.state) ? (formatEta(row.etaSeconds) ?? "—") : "—"}
                    </TableCell>
                    {showDetails && (
                      <TableCell className={`${CELL} whitespace-nowrap`}>{row.details?.quality ?? "—"}</TableCell>
                    )}
                    {showDetails && (
                      <TableCell className={`${CELL} whitespace-nowrap`}>
                        {formatSize(row.details?.sizeBytes ?? 0)}
                      </TableCell>
                    )}
                  </TableRow>
                  {showDetails && isOpen && row.details !== null && (
                    <TableRow id={detailsId}>
                      <TableCell colSpan={columnCount} className="bg-muted/30 px-4 py-2">
                        <DetailList row={row} details={row.details} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}

      {visible.rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Showing {visible.rows.length} {visible.rows.length === 1 ? "item" : "items"}
        </p>
      )}

      {previewVisible && posterPreview.preview}
    </div>
  );
}

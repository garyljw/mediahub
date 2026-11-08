"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, FolderInput, Trash2 } from "lucide-react";
import { Fragment, useState, type HTMLAttributes } from "react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Poster } from "@/components/poster/poster";
import { usePosterPreview } from "@/components/poster/use-poster-preview";
import { ACTIVITY_CLASS, ACTIVITY_ICON } from "@/components/library/activity-cell";
import { showsEtaFor, showsProgressFor, stateLabel } from "@/components/library/activity";
import { toggleOnClick, CELL, HEAD, RowMenu } from "@/components/library/table-parts";
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
import { QueueImportDialog } from "./queue-import-dialog";
import { QueueRemoveDialog } from "./queue-remove-dialog";
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

/** Shown on a row whose download was grabbed with "Replace existing file" ticked. */
const REPLACING_LABEL = "Will replace existing file";

/** The status with its icon, in the colour of its severity. Same markup in the table and on the cards. */
function StatusLabel({ row }: { row: QueueRow }) {
  const Icon = ACTIVITY_ICON[row.state];
  return (
    <span className={`flex min-w-0 items-center gap-1.5 whitespace-nowrap ${ACTIVITY_CLASS[row.severity]}`}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {stateLabel(row.state)}
    </span>
  );
}

/** The ⋯ menu for an admin row or card. Force import and Remove open dialogs that the page holds. */
function QueueMenu({
  row,
  onOpen,
  onClosed,
  onImport,
  onRemove,
}: {
  row: QueueRow;
  onOpen: () => void;
  onClosed: () => void;
  onImport: (row: QueueRow) => void;
  onRemove: (row: QueueRow) => void;
}) {
  return (
    <RowMenu title={row.title} onOpen={onOpen} onClosed={onClosed}>
      {(defer) => (
        <>
          {row.canForceImport && (
            <DropdownMenuItem onSelect={() => defer(() => onImport(row))}>
              <FolderInput aria-hidden />
              Force import…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => defer(() => onRemove(row))}>
            <Trash2 aria-hidden />
            Remove…
          </DropdownMenuItem>
        </>
      )}
    </RowMenu>
  );
}

/** One queue item on narrow screens: the poster, the title and facts (all wrapping), and the actions. */
function QueueCard({
  row,
  previewHandlers,
  showDetails,
  canRemove,
  isOpen,
  onToggle,
  onMenuOpen,
  onMenuClosed,
  onImport,
  onRemove,
}: {
  row: QueueRow;
  /** The poster hover preview's handlers (mouse only), as on the table rows. */
  previewHandlers: HTMLAttributes<HTMLLIElement>;
  showDetails: boolean;
  canRemove: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onMenuOpen: () => void;
  onMenuClosed: () => void;
  onImport: (row: QueueRow) => void;
  onRemove: (row: QueueRow) => void;
}) {
  const detailsId = `queue-card-details-${row.key}`;
  const showProgress = showsProgressFor(row.state) && row.progress !== null;
  const eta = showsEtaFor(row.state) ? formatEta(row.etaSeconds) : null;
  return (
    <li
      className={`rounded-xl border bg-card p-3 ${showDetails && row.details !== null ? "cursor-pointer" : ""}`}
      {...previewHandlers}
      onClick={showDetails && row.details !== null ? toggleOnClick(onToggle) : undefined}
    >
      <div className="flex gap-3">
        <Poster src={row.posterSrc} />
        <div className="flex min-w-0 flex-1 items-start gap-2" data-poster-anchor>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-words font-medium">
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
            {row.detail !== "" && <p className="break-words text-xs text-muted-foreground">{row.detail}</p>}
            <div className="flex flex-wrap items-center gap-x-1.5 text-sm">
              <StatusLabel row={row} />
              {showProgress && <span className="text-muted-foreground">{`· ${row.progress}%`}</span>}
              {eta !== null && <span className="text-muted-foreground">{`· ${eta}`}</span>}
              {row.replacing && <span className="text-xs text-muted-foreground">{REPLACING_LABEL}</span>}
            </div>
            {row.messages.length > 0 && <p className="break-words text-xs text-muted-foreground">{row.messages[0]}</p>}
            {showDetails && (
              <p className="text-xs text-muted-foreground">
                {`${row.details?.quality ?? "—"} · ${formatSize(row.details?.sizeBytes ?? 0)}`}
              </p>
            )}
          </div>
          <div className="-mt-1 -mr-1 flex shrink-0 items-start">
            {showDetails && row.details !== null && (
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={detailsId}
                aria-label={`${isOpen ? "Hide" : "Show"} details for ${row.title}`}
                onClick={onToggle}
                className="grid size-8 place-items-center rounded-md text-muted-foreground hover:text-foreground"
              >
                {isOpen ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
              </button>
            )}
            {canRemove && (
              <QueueMenu row={row} onOpen={onMenuOpen} onClosed={onMenuClosed} onImport={onImport} onRemove={onRemove} />
            )}
          </div>
        </div>
      </div>
      {showDetails && isOpen && row.details !== null && (
        <div id={detailsId} data-card-details className="mt-3 cursor-auto border-t pt-3">
          <DetailList row={row} details={row.details} />
        </div>
      )}
    </li>
  );
}

/**
 * The Queue page's table. Entries arrive already built by the server, so no time is formatted in the browser. It
 * refreshes the server data every few seconds while the tab is visible. A side whose request failed keeps its last
 * known rows, with an alert saying so. Admins see the release columns and can expand a row for its download facts and
 * messages, and can remove a row. Requesters see the status columns only.
 */
export function QueueView({
  rows,
  failed,
  showDetails,
  canRemove,
}: {
  /** The fresh rows from the server, for both apps. Rows of an app that failed this time are ignored. */
  rows: QueueRow[];
  failed: QueueFailures;
  /** True for an admin: the Quality and Size columns, and the expandable rows. */
  showDetails: boolean;
  /** True for an admin: each row gets a Remove button. The server checks the role again on remove. */
  canRemove: boolean;
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
  // The row the Remove dialog is open for. Kept as a snapshot, so the dialog doesn't change if the row leaves the queue.
  const [removing, setRemoving] = useState<QueueRow | null>(null);
  // The row the Force import dialog is open for. A snapshot, like the Remove dialog's.
  const [importing, setImporting] = useState<QueueRow | null>(null);
  // The row whose ⋯ menu is open. Its poster preview is hidden meanwhile, as on other lists.
  const [menuRowKey, setMenuRowKey] = useState<string | null>(null);
  const posterPreview = usePosterPreview<string>();

  // The preview belongs to a row. Hide it when that row is gone (for example after a refresh).
  const previewVisible =
    menuRowKey === null &&
    removing === null &&
    importing === null &&
    posterPreview.activeKey !== null &&
    visible.rows.some((row) => row.key === posterPreview.activeKey);
  const columnCount = (showDetails ? 7 : 5) + (canRemove ? 1 : 0);

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
        <>
        <div className="hidden lg:block">
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
              {canRemove && (
                <TableHead className={HEAD}>
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.rows.map((row) => {
              const isOpen = expanded.has(row.key);
              const detailsId = `queue-details-${row.key}`;
              return (
                <Fragment key={row.key}>
                  <TableRow
                    className={showDetails && row.details !== null ? "cursor-pointer" : undefined}
                    {...posterPreview.rowHandlers(row.key, row.posterSrc, {
                      title: row.title,
                      kind: row.kind === "movie" ? "movie" : "series",
                      peek: row.peek,
                    })}
                    onClick={showDetails && row.details !== null ? toggleOnClick(() => toggleExpanded(row.key)) : undefined}
                  >
                    <TableCell className={CELL}>
                      <Poster src={row.posterSrc} />
                    </TableCell>
                    <TableCell className={`${CELL} max-w-0 w-full min-w-48`} data-poster-anchor>
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
                    {/* Like the Activity column: the first message (admins only) shows under the state, all of them on hover. */}
                    <TableCell className={CELL} title={[stateLabel(row.state), ...row.messages].join("\n")}>
                      <StatusLabel row={row} />
                      {row.replacing && <p className="mt-0.5 text-xs text-muted-foreground">{REPLACING_LABEL}</p>}
                      {row.messages.length > 0 && (
                        <p className="mt-0.5 max-w-64 truncate text-xs text-muted-foreground">{row.messages[0]}</p>
                      )}
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
                    {canRemove && (
                      <TableCell className={`${CELL} text-right`}>
                        <QueueMenu
                          row={row}
                          onOpen={() => setMenuRowKey(row.key)}
                          onClosed={() => setMenuRowKey((previous) => (previous === row.key ? null : previous))}
                          onImport={setImporting}
                          onRemove={setRemoving}
                        />
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
        </div>
        <ul className="space-y-2 lg:hidden">
          {visible.rows.map((row) => (
            <QueueCard
              key={row.key}
              previewHandlers={posterPreview.rowHandlers(row.key, row.posterSrc, {
                title: row.title,
                kind: row.kind === "movie" ? "movie" : "series",
                peek: row.peek,
              })}
              row={row}
              showDetails={showDetails}
              canRemove={canRemove}
              isOpen={expanded.has(row.key)}
              onToggle={() => toggleExpanded(row.key)}
              onMenuOpen={() => setMenuRowKey(row.key)}
              onMenuClosed={() => setMenuRowKey((previous) => (previous === row.key ? null : previous))}
              onImport={setImporting}
              onRemove={setRemoving}
            />
          ))}
        </ul>
        </>
      )}

      {visible.rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Showing {visible.rows.length} {visible.rows.length === 1 ? "item" : "items"}
        </p>
      )}

      {removing !== null && <QueueRemoveDialog row={removing} onClose={() => setRemoving(null)} />}

      {importing !== null && <QueueImportDialog row={importing} onClose={() => setImporting(null)} />}

      {previewVisible && posterPreview.preview}
    </div>
  );
}

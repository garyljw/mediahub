"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Bookmark, BookmarkCheck, RefreshCw, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { QualityProfileOption } from "@/server/arr/profiles";
import type { SeriesRow } from "@/server/arr/series";
import { refreshLibrarySeries, removeSeries, searchLibrarySeries } from "@/app/(app)/tv/actions";
import { clampPage, nextSort, pageCount, pageSlice, profileOptions, type MonitoredFilter } from "@/components/library/list";
import { CELL, HEAD, Pagination, RowMenu, SELECT_CLASS, SortHeader } from "@/components/library/table-parts";
import { LibraryDeleteDialog } from "@/components/library/delete-dialog";
import { SERIES } from "@/components/library/nouns";
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  FIRST_DIR,
  episodeFraction,
  filterSeries,
  hasActiveFilters,
  isMissing,
  sortSeries,
  type MissingFilter,
  type SeriesFilters,
  type SortKey,
  type SortState,
  type StatusFilter,
} from "./series-filters";
import { formatAdded, formatCount, formatSize } from "@/components/library/format";
import { deletedMessage } from "@/components/library/delete";
import { pruneSelection, selectAllState, toggleAllFiltered, toggleId } from "@/components/library/selection";
import { MAX_BULK_SERIES } from "./series-bulk";
import { MAX_REFRESH_SERIES, refreshStartedMessage } from "./series-refresh";
import { MAX_SEARCH_SERIES, searchStartedMessage } from "./series-search";
import { STATUS_CLASS, STATUS_LABEL } from "./series-status";
import { Poster } from "@/components/poster/poster";
import { usePosterPreview } from "@/components/poster/use-poster-preview";
import { ActivityCell, ActivityHead } from "@/components/library/activity-cell";
import { useActivity } from "@/components/library/use-activity";

/** A row's thumbnail and preview come from MediaHub's own poster route, and only when Sonarr has a poster. */
function seriesPosterSrc(row: SeriesRow): string | null {
  return row.hasPoster ? `/api/tv/${row.id}/poster` : null;
}

// Nine data columns: title, year, status, activity, episodes, monitored, profile, size and added. Every role also
// gets the checkbox and actions columns, since requesters can select series and search for them.
const DATA_COLUMN_COUNT = 9;
const STATUS_MS = 4000;

/**
 * One series' episode cell: "have/want" and a thin bar. Green when every expected episode is on disk, amber
 * when some are missing. Sonarr's own figure is the same have/want pair, so the two always agree.
 */
function EpisodesCell({ row }: { row: SeriesRow }) {
  const missing = isMissing(row);
  const percent = Math.round(episodeFraction(row) * 100);
  return (
    <TableCell className={CELL}>
      <span className={cn("tabular-nums", missing ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
        {formatCount(row.episodeFileCount)}/{formatCount(row.episodeCount)}
      </span>
      <div
        role="progressbar"
        aria-label={`${formatCount(row.episodeFileCount)} of ${formatCount(row.episodeCount)} episodes for ${row.title}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-1 h-1 w-20 overflow-hidden rounded bg-muted"
      >
        <div className={cn("h-full", missing ? "bg-amber-500" : "bg-emerald-600")} style={{ width: `${percent}%` }} />
      </div>
    </TableCell>
  );
}

export function SeriesTable({
  rows,
  profiles,
  isAdmin,
}: {
  rows: SeriesRow[];
  profiles: QualityProfileOption[];
  /** Admins also get Refresh & scan and Delete. Everyone can select series and search for them. */
  isAdmin: boolean;
}) {
  const [filters, setFilters] = useState<SeriesFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  // The series the delete dialog is removing, as a snapshot taken when it opened.
  const [deleting, setDeleting] = useState<{ series: SeriesRow[] } | null>(null);
  // The row whose ⋯ menu is open. Its poster preview is hidden so the large image doesn't cover the menu.
  const [menuRowId, setMenuRowId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  // The large poster shown beside the hovered row's thumbnail (mouse only, see the hook).
  const posterPreview = usePosterPreview<number>();
  // Live Sonarr queue state per series, polled from the browser. Empty until the first reply arrives.
  const activity = useActivity("/api/tv/activity");
  const searchRef = useRef<HTMLInputElement>(null);

  // Autofocus the search box on desktop only, so phones don't pop the keyboard.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) searchRef.current?.focus();
  }, []);

  // The status line clears itself after a few seconds.
  useEffect(() => {
    if (status === null) return;
    const timer = window.setTimeout(() => setStatus(null), STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const options = useMemo(() => profileOptions(rows, profiles), [rows, profiles]);
  const filtered = useMemo(() => filterSeries(rows, filters), [rows, filters]);
  const sorted = useMemo(() => sortSeries(filtered, sort), [filtered, sort]);
  const pages = pageCount(sorted.length);
  const current = clampPage(page, sorted.length);
  const visible = pageSlice(sorted, current);
  // Only an id that matches a visible row counts. A row removed while its menu is open would otherwise hide previews for good.
  const menuOpenOnVisibleRow = menuRowId !== null && visible.some((row) => row.id === menuRowId);
  // Only selected series that match the current search and filters count. A bulk action never touches a series
  // the admin can't see, and a refresh that removes a series drops it too. Hidden picks come back if the filter
  // is changed back. So toggles update `selected` (the full set); selectedIds is what the bulk actions use.
  const selectedIds = useMemo(() => pruneSelection(selected, filtered), [selected, filtered]);
  // The same filter-pruned selection as selectedIds, as rows. Delete shows these titles and sends their ids.
  const selectedRows = useMemo(() => filtered.filter((row) => selectedIds.has(row.id)), [filtered, selectedIds]);
  const allState = selectAllState(selectedIds, filtered);

  // Filter and search changes go back to page 1. The handlers do this, not an effect.
  function updateFilters(patch: Partial<SeriesFilters>) {
    setFilters((previous) => ({ ...previous, ...patch }));
    setPage(1);
  }

  function changeSort(key: SortKey) {
    setSort((previous) => nextSort(previous, key, FIRST_DIR));
    setPage(1);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  // Any selection change also clears the status line, so it never describes an old action.
  function updateSelection(next: Set<number>) {
    setSelected(next);
    setStatus(null);
  }

  function openDeleter(series: SeriesRow[]) {
    setStatus(null);
    setDeleting({ series });
  }

  function handleDeleted(seriesCount: number) {
    // Drop only the deleted series from the selection. Picks hidden by the current filter stay.
    const gone = new Set(deleting?.series.map((entry) => entry.id));
    setSelected((previous) => new Set([...previous].filter((id) => !gone.has(id))));
    setDeleting(null);
    setStatus(deletedMessage(seriesCount, SERIES));
  }

  // Starts a Sonarr release search for each series. A bulk search keeps its selection so the user can see what was searched.
  function startSeriesSearch(ids: number[]) {
    setStatus(null);
    startSearch(async () => {
      try {
        const result = await searchLibrarySeries({ seriesIds: ids });
        // A search that stopped partway deselects the series Sonarr accepted, so a retry only sends the rest.
        if (!result.ok && result.startedIds) {
          const started = new Set(result.startedIds);
          setSelected((previous) => new Set([...previous].filter((id) => !started.has(id))));
        }
        setStatus(result.ok ? searchStartedMessage(result.searched) : result.error);
      } catch {
        // The request never got an answer (connection lost, server restarted), so say so instead of failing the page.
        setStatus("Couldn't reach MediaHub. Check your connection and try again.");
      }
    });
  }

  // Starts a Sonarr refresh and disk rescan. A bulk refresh keeps its selection, like search.
  function startSeriesRefresh(ids: number[]) {
    setStatus(null);
    startRefresh(async () => {
      try {
        const result = await refreshLibrarySeries({ seriesIds: ids });
        setStatus(result.ok ? refreshStartedMessage(result.refreshed) : result.error);
      } catch {
        // The request never got an answer (connection lost, server restarted), so say so instead of failing the page.
        setStatus("Couldn't reach MediaHub. Check your connection and try again.");
      }
    });
  }

  const tooManyToSearch = selectedIds.size > MAX_SEARCH_SERIES;
  const tooManyToRefresh = selectedIds.size > MAX_REFRESH_SERIES;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={searchRef}
          type="search"
          placeholder="Search series…"
          aria-label="Search series"
          value={filters.search}
          onChange={(e) => updateFilters({ search: e.target.value })}
          className="h-9 w-full sm:w-64"
        />
        <select
          aria-label="Status"
          value={filters.status}
          onChange={(e) => updateFilters({ status: e.target.value as StatusFilter })}
          className={SELECT_CLASS}
        >
          <option value="all">All</option>
          <option value="continuing">Continuing</option>
          <option value="ended">Ended</option>
          <option value="upcoming">Upcoming</option>
        </select>
        <select
          aria-label="Monitored"
          value={filters.monitored}
          onChange={(e) => updateFilters({ monitored: e.target.value as MonitoredFilter })}
          className={SELECT_CLASS}
        >
          <option value="all">All</option>
          <option value="monitored">Monitored</option>
          <option value="unmonitored">Unmonitored</option>
        </select>
        <select
          aria-label="Quality profile"
          value={filters.profileId === "all" ? "all" : String(filters.profileId)}
          onChange={(e) =>
            updateFilters({ profileId: e.target.value === "all" ? "all" : Number(e.target.value) })
          }
          className={SELECT_CLASS}
        >
          <option value="all">All</option>
          {options.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Missing episodes"
          value={filters.missing}
          onChange={(e) => updateFilters({ missing: e.target.value as MissingFilter })}
          className={SELECT_CLASS}
        >
          <option value="all">All episodes</option>
          <option value="complete">Complete</option>
          <option value="missing">Missing episodes</option>
        </select>
        <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
          {formatCount(filtered.length)} of {formatCount(rows.length)} series
        </p>
      </div>

      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {status}
      </p>
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{formatCount(selectedIds.size)} selected</span>
          <Button
            size="sm"
            onClick={() => startSeriesSearch([...selectedIds])}
            disabled={searching || tooManyToSearch}
            aria-busy={searching}
          >
            Search…
          </Button>
          {isAdmin && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => startSeriesRefresh([...selectedIds])}
                disabled={refreshing || tooManyToRefresh}
                aria-busy={refreshing}
              >
                Refresh &amp; scan
              </Button>
              <Button size="sm" variant="destructive" onClick={() => openDeleter(selectedRows)}>
                Delete…
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => updateSelection(new Set())}>
            Clear
          </Button>
          {tooManyToSearch && (
            <span role="alert" className="text-destructive">
              Select at most {formatCount(MAX_SEARCH_SERIES)} series to search.
            </span>
          )}
          {isAdmin && tooManyToRefresh && (
            <span role="alert" className="text-destructive">
              Select at most {formatCount(MAX_REFRESH_SERIES)} series to refresh.
            </span>
          )}
        </div>
      )}

      <div
        className="max-h-[70vh] overflow-auto rounded-md border"
        onScroll={() => posterPreview.clear()}
      >
        <Table className="table-fixed min-w-[68rem]">
          <TableHeader>
            <TableRow>
              <TableHead className={cn(HEAD, "w-8")}>
                <input
                  type="checkbox"
                  aria-label="Select all series that match the filters"
                  checked={allState === "all"}
                  ref={(el) => {
                    if (el) el.indeterminate = allState === "some";
                  }}
                  disabled={filtered.length === 0}
                  onChange={() => updateSelection(toggleAllFiltered(selected, filtered))}
                  className="size-4 accent-primary"
                />
              </TableHead>
              <SortHeader label="Title" sortKey="title" sort={sort} onSort={changeSort} />
              <SortHeader label="Year" sortKey="year" sort={sort} onSort={changeSort} width="w-16" />
              <TableHead className={cn(HEAD, "w-28")}>Status</TableHead>
              <TableHead className={cn(HEAD, "w-48")}>
                <ActivityHead failed={activity.failed} source="Sonarr" />
              </TableHead>
              <SortHeader label="Episodes" sortKey="episodes" sort={sort} onSort={changeSort} width="w-28" />
              <TableHead className={cn(HEAD, "w-24 text-center")}>Monitored</TableHead>
              <TableHead className={cn(HEAD, "w-28")}>Quality profile</TableHead>
              <SortHeader label="Size" sortKey="size" sort={sort} onSort={changeSort} align="right" width="w-20" />
              <SortHeader label="Added" sortKey="added" sort={sort} onSort={changeSort} width="w-28" />
              <TableHead className={cn(HEAD, "w-24")}>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow
                key={row.id}
                data-state={selectedIds.has(row.id) ? "selected" : undefined}
                {...posterPreview.rowHandlers(row.id, seriesPosterSrc(row))}
              >
                <TableCell className={CELL}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.title}`}
                    checked={selectedIds.has(row.id)}
                    onChange={() => updateSelection(toggleId(selected, row.id))}
                    className="size-4 accent-primary"
                  />
                </TableCell>
                <TableCell className={CELL} data-poster-anchor>
                  <div className="flex min-w-0 items-center gap-2">
                    <Poster src={seriesPosterSrc(row)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate" title={row.title}>
                        <Link href={`/tv/${row.id}`} className="font-medium hover:underline">
                          {row.title}
                        </Link>
                      </div>
                      {row.network !== null && (
                        <p className="truncate text-xs text-muted-foreground">{row.network}</p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cn(CELL, "tabular-nums text-muted-foreground")}>
                  {row.year ?? "—"}
                </TableCell>
                <TableCell className={CELL}>
                  <Badge variant="outline" className={STATUS_CLASS[row.status]}>
                    {STATUS_LABEL[row.status]}
                  </Badge>
                </TableCell>
                <ActivityCell name={row.title} activity={activity.byId.get(row.id)} />
                <EpisodesCell row={row} />
                <TableCell className={cn(CELL, "text-center")}>
                  {row.monitored ? (
                    <BookmarkCheck aria-hidden className="inline size-4 text-primary" />
                  ) : (
                    <Bookmark aria-hidden className="inline size-4 text-muted-foreground/60" />
                  )}
                  <span className="sr-only">{row.monitored ? "Monitored" : "Unmonitored"}</span>
                </TableCell>
                <TableCell className={cn(CELL, "truncate")}>{row.qualityProfile}</TableCell>
                <TableCell className={cn(CELL, "text-right tabular-nums")}>
                  {formatSize(row.sizeOnDisk)}
                </TableCell>
                <TableCell className={cn(CELL, "tabular-nums")}>{formatAdded(row.added)}</TableCell>
                <TableCell className={cn(CELL, "text-right")}>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Search for ${row.title}`}
                      onClick={() => startSeriesSearch([row.id])}
                      disabled={searching}
                    >
                      <Search aria-hidden />
                    </Button>
                    {isAdmin && (
                      <RowMenu
                        title={row.title}
                        onOpen={() => setMenuRowId(row.id)}
                        onClosed={() => setMenuRowId((previous) => (previous === row.id ? null : previous))}
                      >
                        {(defer) => (
                          <>
                            <DropdownMenuItem disabled={refreshing} onSelect={() => startSeriesRefresh([row.id])}>
                              <RefreshCw aria-hidden />
                              Refresh &amp; scan
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => defer(() => openDeleter([row]))}>
                              <Trash2 aria-hidden />
                              Delete…
                            </DropdownMenuItem>
                          </>
                        )}
                      </RowMenu>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={DATA_COLUMN_COUNT + 2} className="py-8 text-center text-muted-foreground">
                  {rows.length === 0 ? (
                    "No series in Sonarr yet."
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <p>No series match.</p>
                      {hasActiveFilters(filters) && (
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Hidden while a dialog is open: clicking a row's Delete opens it with the mouse still on the row. */}
      {posterPreview.activeKey !== null &&
        !menuOpenOnVisibleRow &&
        !deleting &&
        visible.some((row) => row.id === posterPreview.activeKey) &&
        posterPreview.preview}

      {isAdmin && deleting && (
        <LibraryDeleteDialog
          items={deleting.series}
          noun={SERIES}
          max={MAX_BULK_SERIES}
          appName="Sonarr"
          exclusionLabel="Prevent this series from being re-added by import lists"
          submit={({ ids, deleteFiles, addExclusion, confirmCount }) =>
            removeSeries({ seriesIds: ids, deleteFiles, addImportListExclusion: addExclusion, confirmCount })
          }
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}

      <Pagination current={current} pages={pages} onPage={setPage} />
    </div>
  );
}

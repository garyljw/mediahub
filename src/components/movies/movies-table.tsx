"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, BookmarkCheck, Pencil, RefreshCw, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { refreshLibraryMovies, searchLibraryMovies } from "@/app/(app)/movies/actions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { MovieRow, MovieStatus, QualityProfileOption } from "@/server/arr/movies";
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  clampPage,
  filterMovies,
  hasActiveFilters,
  nextSort,
  pageCount,
  pageSlice,
  sortMovies,
  type MonitoredFilter,
  type MovieFilters,
  type SortKey,
  type SortState,
  type StatusFilter,
  profileOptions,
} from "./movie-filters";
import { formatAdded, formatCount, formatSize } from "./movie-format";
import {
  pruneSelection,
  selectAllState,
  toggleAllFiltered,
  toggleId,
  updatedMessage,
} from "./movie-edit";
import { deletedMessage } from "./movie-delete";
import { MAX_REFRESH_MOVIES, refreshStartedMessage } from "./movie-refresh";
import { MAX_SEARCH_MOVIES, searchStartedMessage } from "./movie-search";
import { MovieDeleteDialog } from "./movie-delete-dialog";
import { MovieEditDialog, SELECT_CLASS } from "./movie-edit-dialog";
import { Poster } from "@/components/poster/poster";
import { usePosterPreview } from "@/components/poster/use-poster-preview";

const STATUS_LABEL: Record<MovieStatus, string> = {
  downloaded: "Downloaded",
  missing: "Missing",
  unreleased: "Unreleased",
};

const STATUS_CLASS: Record<MovieStatus, string> = {
  downloaded: "border-transparent bg-emerald-600/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  missing: "border-transparent bg-amber-500/20 text-amber-800 dark:text-amber-300",
  unreleased: "border-transparent bg-muted text-muted-foreground",
};

/** A row's thumbnail and preview come from MediaHub's own poster route, and only when Radarr has a poster. */
function moviePosterSrc(row: MovieRow): string | null {
  return row.hasPoster ? `/api/movies/${row.id}/poster` : null;
}

const CELL = "py-1.5 px-2";
const HEAD = "sticky top-0 z-10 h-8 border-b bg-background py-1.5 px-2";
// Eight data columns plus the checkbox and the actions column, which every role gets (Search is open to requesters).
const COLUMN_COUNT = 10;
// How long the "Updated N movies" line stays before it clears itself.
const STATUS_MS = 4000;

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      className={cn(HEAD, align === "right" && "text-right")}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      >
        {label}
        <Icon aria-hidden className={cn("size-3.5", !active && "text-muted-foreground/60")} />
      </button>
    </TableHead>
  );
}

export function MoviesTable({
  rows,
  profiles,
  isAdmin,
}: {
  rows: MovieRow[];
  profiles: QualityProfileOption[];
  /** Admins also get Refresh & scan, Edit and Delete. Everyone can select movies and search for them. */
  isAdmin: boolean;
}) {
  const [filters, setFilters] = useState<MovieFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  // The movies the dialog is editing: one row, or the whole selection (no title).
  const [editing, setEditing] = useState<{ ids: number[]; title?: string; fromSelection: boolean } | null>(null);
  // The movies the delete dialog is removing, as a snapshot taken when it opened. Same rule as editing.
  const [deleting, setDeleting] = useState<{ movies: MovieRow[] } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  // The large poster shown beside the hovered row's thumbnail (mouse only, see the hook).
  const posterPreview = usePosterPreview<number>();
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
  const filtered = useMemo(() => filterMovies(rows, filters), [rows, filters]);
  const sorted = useMemo(() => sortMovies(filtered, sort), [filtered, sort]);
  const pages = pageCount(sorted.length);
  const current = clampPage(page, sorted.length);
  const visible = pageSlice(sorted, current);
  // Only selected movies that match the current search and filters count. Edit never touches a movie
  // the admin can't see, and a refresh that removes a movie drops it too. Hidden picks come back if
  // the filter is changed back. So toggles update `selected` (the full set); selectedIds is display/edit only.
  const selectedIds = useMemo(() => pruneSelection(selected, filtered), [selected, filtered]);
  // The same filter-pruned selection as selectedIds, as rows. Delete shows these titles and sends their ids.
  const selectedRows = useMemo(() => filtered.filter((row) => selectedIds.has(row.id)), [filtered, selectedIds]);
  const allState = selectAllState(selectedIds, filtered);

  // Filter and search changes go back to page 1. The handlers do this, not an effect.
  function updateFilters(patch: Partial<MovieFilters>) {
    setFilters((previous) => ({ ...previous, ...patch }));
    setPage(1);
  }

  function changeSort(key: SortKey) {
    setSort((previous) => nextSort(previous, key));
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

  function openEditor(ids: number[], fromSelection: boolean, title?: string) {
    setStatus(null);
    setEditing({ ids, title, fromSelection });
  }

  function handleSaved(movieCount: number) {
    // A single-row edit leaves the bulk selection alone. Only a bulk edit uses it up.
    if (editing?.fromSelection) setSelected(new Set());
    setEditing(null);
    setStatus(updatedMessage(movieCount));
  }

  function openDeleter(movies: MovieRow[]) {
    setStatus(null);
    setDeleting({ movies });
  }

  function handleDeleted(movieCount: number) {
    // Drop only the deleted movies from the selection. Picks hidden by the current filter stay.
    const gone = new Set(deleting?.movies.map((movie) => movie.id));
    setSelected((previous) => new Set([...previous].filter((id) => !gone.has(id))));
    setDeleting(null);
    setStatus(deletedMessage(movieCount));
  }

  // Starts a Radarr release search. A bulk search keeps its selection so the user can see what was searched.
  function searchMovies(ids: number[]) {
    setStatus(null);
    startSearch(async () => {
      try {
        const result = await searchLibraryMovies({ movieIds: ids });
        setStatus(result.ok ? searchStartedMessage(result.searched) : result.error);
      } catch {
        // The request never got an answer (connection lost, server restarted), so say so instead of failing the page.
        setStatus("Couldn't reach MediaHub. Check your connection and try again.");
      }
    });
  }

  // Starts a Radarr refresh and disk rescan. A bulk refresh keeps its selection, like search.
  function refreshMovies(ids: number[]) {
    setStatus(null);
    startRefresh(async () => {
      try {
        const result = await refreshLibraryMovies({ movieIds: ids });
        setStatus(result.ok ? refreshStartedMessage(result.refreshed) : result.error);
      } catch {
        // The request never got an answer (connection lost, server restarted), so say so instead of failing the page.
        setStatus("Couldn't reach MediaHub. Check your connection and try again.");
      }
    });
  }

  const noun = rows.length === 1 ? "movie" : "movies";
  const tooManyToSearch = selectedIds.size > MAX_SEARCH_MOVIES;
  const tooManyToRefresh = selectedIds.size > MAX_REFRESH_MOVIES;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={searchRef}
          type="search"
          placeholder="Search movies…"
          aria-label="Search movies"
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
          <option value="downloaded">Downloaded</option>
          <option value="missing">Missing</option>
          <option value="unreleased">Unreleased</option>
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
        <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
          {formatCount(filtered.length)} of {formatCount(rows.length)} {noun}
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
            onClick={() => searchMovies([...selectedIds])}
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
                onClick={() => refreshMovies([...selectedIds])}
                disabled={refreshing || tooManyToRefresh}
                aria-busy={refreshing}
              >
                Refresh &amp; scan
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openEditor([...selectedIds], true)}>
                Edit…
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
              Select at most {formatCount(MAX_SEARCH_MOVIES)} movies to search.
            </span>
          )}
          {isAdmin && tooManyToRefresh && (
            <span role="alert" className="text-destructive">
              Select at most {formatCount(MAX_REFRESH_MOVIES)} movies to refresh.
            </span>
          )}
        </div>
      )}

      <div
        className="max-h-[70vh] overflow-auto rounded-md border"
        onScroll={() => posterPreview.clear()}
      >
        <Table className="min-w-[60rem]">
          <TableHeader>
            <TableRow>
              <TableHead className={cn(HEAD, "w-8")}>
                <input
                  type="checkbox"
                  aria-label="Select all movies that match the filters"
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
              <SortHeader label="Year" sortKey="year" sort={sort} onSort={changeSort} />
              <TableHead className={HEAD}>Status</TableHead>
              <TableHead className={cn(HEAD, "text-center")}>Monitored</TableHead>
              <TableHead className={HEAD}>Quality profile</TableHead>
              <TableHead className={HEAD}>File quality</TableHead>
              <SortHeader label="Size" sortKey="size" sort={sort} onSort={changeSort} align="right" />
              <SortHeader label="Added" sortKey="added" sort={sort} onSort={changeSort} />
              <TableHead className={cn(HEAD, "w-px")}>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow
                key={row.id}
                data-state={selectedIds.has(row.id) ? "selected" : undefined}
                {...posterPreview.rowHandlers(row.id, moviePosterSrc(row))}
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
                <TableCell className={CELL}>
                  <div className="flex items-center gap-2">
                    <Poster src={moviePosterSrc(row)} />
                    <div className="min-w-0 max-w-[28rem] truncate">
                      <span className="font-medium">{row.title}</span>
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
                <TableCell className={cn(CELL, "text-center")}>
                  {row.monitored ? (
                    <BookmarkCheck aria-hidden className="inline size-4 text-primary" />
                  ) : (
                    <Bookmark aria-hidden className="inline size-4 text-muted-foreground/60" />
                  )}
                  <span className="sr-only">{row.monitored ? "Monitored" : "Unmonitored"}</span>
                </TableCell>
                <TableCell className={CELL}>{row.qualityProfile}</TableCell>
                <TableCell className={CELL}>{row.fileQuality ?? "—"}</TableCell>
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
                      onClick={() => searchMovies([row.id])}
                      disabled={searching}
                    >
                      <Search aria-hidden />
                    </Button>
                    {isAdmin && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Refresh and scan ${row.title}`}
                          onClick={() => refreshMovies([row.id])}
                          disabled={refreshing}
                        >
                          <RefreshCw aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${row.title}`}
                          onClick={() => openEditor([row.id], false, row.title)}
                        >
                          <Pencil aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${row.title}`}
                          onClick={() => openDeleter([row])}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-muted-foreground">
                  {rows.length === 0 ? (
                    "No movies in Radarr yet."
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <p>No movies match.</p>
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

      {isAdmin && editing && (
        <MovieEditDialog
          ids={editing.ids}
          title={editing.title}
          profiles={profiles}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Hidden while a dialog is open: clicking a row's Edit or Delete opens it with the mouse still on the row. */}
      {posterPreview.activeKey !== null &&
        !editing &&
        !deleting &&
        visible.some((row) => row.id === posterPreview.activeKey) &&
        posterPreview.preview}

      {isAdmin && deleting && (
        <MovieDeleteDialog
          movies={deleting.movies}
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}

      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={current <= 1} onClick={() => setPage(current - 1)}>
            Prev
          </Button>
          <span>
            Page {current} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={current >= pages}
            onClick={() => setPage(current + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}

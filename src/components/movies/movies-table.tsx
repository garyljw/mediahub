"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Bookmark,
  BookmarkCheck,
  RefreshCw,
  Search,
  Trash2,
  UserSearch,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  findMovieReleases,
  grabMovieRelease,
  refreshLibraryMovies,
  removeMovies,
  searchLibraryMovies,
} from "@/app/(app)/movies/actions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { MovieRow } from "@/server/arr/movies";
import { STATUS_CLASS, STATUS_LABEL } from "./movie-status";
import type { QualityProfileOption } from "@/server/arr/profiles";
import { clampPage, nextSort, pageCount, pageSlice, profileOptions, type MonitoredFilter } from "@/components/library/list";
import { CELL, HEAD, Pagination, RowMenu, SELECT_CLASS, SortHeader } from "@/components/library/table-parts";
import { LibraryDeleteDialog } from "@/components/library/delete-dialog";
import { MOVIE } from "@/components/library/nouns";
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  FIRST_DIR,
  filterMovies,
  hasActiveFilters,
  sortMovies,
  type MovieFilters,
  type SortKey,
  type SortState,
  type StatusFilter,
} from "./movie-filters";
import { formatAdded, formatCount, formatSize } from "@/components/library/format";
import { deletedMessage } from "@/components/library/delete";
import { pruneSelection, selectAllState, toggleAllFiltered, toggleId } from "@/components/library/selection";
import { MAX_BULK_MOVIES } from "./movie-bulk";
import { ActivityCell, ActivityHead } from "@/components/library/activity-cell";
import { useActivity } from "@/components/library/use-activity";
import { MAX_REFRESH_MOVIES, refreshStartedMessage } from "./movie-refresh";
import { MAX_SEARCH_MOVIES, searchStartedMessage } from "./movie-search";
import { ReleaseDialog } from "@/components/library/release-dialog";
import { grabbedMessage } from "@/components/library/release";
import { Poster } from "@/components/poster/poster";
import { usePosterPreview } from "@/components/poster/use-poster-preview";

/** A row's thumbnail and preview come from MediaHub's own poster route, and only when Radarr has a poster. */
function moviePosterSrc(row: MovieRow): string | null {
  return row.hasPoster ? `/api/movies/${row.id}/poster` : null;
}

// Nine data columns plus the checkbox and the actions column, which every role gets (Search is open to requesters).
const COLUMN_COUNT = 11;
// How long the "Updated N movies" line stays before it clears itself.
const STATUS_MS = 4000;

export function MoviesTable({
  rows,
  profiles,
  isAdmin,
}: {
  rows: MovieRow[];
  profiles: QualityProfileOption[];
  /** Admins also get Pick a release, Refresh & scan and Delete. Everyone can select movies and search for them. */
  isAdmin: boolean;
}) {
  const [filters, setFilters] = useState<MovieFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  // The movies the delete dialog is removing, as a snapshot taken when it opened.
  const [deleting, setDeleting] = useState<{ movies: MovieRow[] } | null>(null);
  // The movie whose release picker is open. Admin only, and one movie at a time.
  const [picking, setPicking] = useState<{ id: number; title: string } | null>(null);
  // The row whose ⋯ menu is open. Its poster preview is hidden so the large image doesn't cover the menu.
  const [menuRowId, setMenuRowId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  // The large poster shown beside the hovered row's thumbnail (mouse only, see the hook).
  const posterPreview = usePosterPreview<number>();
  // Live Radarr queue state, polled from the browser. Empty until the first reply arrives.
  const activity = useActivity("/api/movies/activity");
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
  // Only an id that matches a visible row counts. A row refreshed away while its menu is open would otherwise hide previews for good.
  const menuOpenOnVisibleRow = menuRowId !== null && visible.some((row) => row.id === menuRowId);
  // Only selected movies that match the current search and filters count. A bulk action never touches a movie
  // the admin can't see, and a refresh that removes a movie drops it too. Hidden picks come back if
  // the filter is changed back. So toggles update `selected` (the full set); selectedIds is what the bulk actions use.
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

  function openPicker(row: MovieRow) {
    setStatus(null);
    setPicking({ id: row.id, title: row.title });
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
    setStatus(deletedMessage(movieCount, MOVIE));
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

  const noun = rows.length === 1 ? MOVIE.one : MOVIE.many;
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
        <Table className="table-fixed min-w-[72rem]">
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
              <SortHeader label="Year" sortKey="year" sort={sort} onSort={changeSort} width="w-16" />
              <TableHead className={cn(HEAD, "w-28")}>Status</TableHead>
              <TableHead className={cn(HEAD, "w-48")}>
                <ActivityHead failed={activity.failed} source="Radarr" />
              </TableHead>
              <TableHead className={cn(HEAD, "w-24 text-center")}>Monitored</TableHead>
              <TableHead className={cn(HEAD, "w-28")}>Quality profile</TableHead>
              <TableHead className={cn(HEAD, "w-32")}>File quality</TableHead>
              <SortHeader label="Size" sortKey="size" sort={sort} onSort={changeSort} align="right" width="w-20" />
              <SortHeader label="Added" sortKey="added" sort={sort} onSort={changeSort} width="w-28" />
              <TableHead className={cn(HEAD, isAdmin ? "w-24" : "w-14")}>
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
                <TableCell className={CELL} data-poster-anchor>
                  <div className="flex min-w-0 items-center gap-2">
                    <Poster src={moviePosterSrc(row)} />
                    <div className="min-w-0 flex-1 truncate" title={row.title}>
                      <Link href={`/movies/${row.id}`} className="font-medium hover:underline">
                        {row.title}
                      </Link>
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
                <TableCell className={cn(CELL, "text-center")}>
                  {row.monitored ? (
                    <BookmarkCheck aria-hidden className="inline size-4 text-primary" />
                  ) : (
                    <Bookmark aria-hidden className="inline size-4 text-muted-foreground/60" />
                  )}
                  <span className="sr-only">{row.monitored ? "Monitored" : "Unmonitored"}</span>
                </TableCell>
                <TableCell className={cn(CELL, "truncate")}>{row.qualityProfile}</TableCell>
                <TableCell className={cn(CELL, "truncate")}>{row.fileQuality ?? "—"}</TableCell>
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
                      <RowMenu
                        title={row.title}
                        onOpen={() => setMenuRowId(row.id)}
                        onClosed={() => setMenuRowId((previous) => (previous === row.id ? null : previous))}
                      >
                        {(defer) => (
                          <>
                            <DropdownMenuItem onSelect={() => defer(() => openPicker(row))}>
                              <UserSearch aria-hidden />
                              Pick a release…
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={refreshing} onSelect={() => refreshMovies([row.id])}>
                              <RefreshCw aria-hidden />
                              Refresh &amp; scan
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
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

      {isAdmin && picking && (
        <ReleaseDialog
          key={picking.id}
          subject={picking.title}
          search={() => findMovieReleases({ movieId: picking.id })}
          grab={(token) => grabMovieRelease({ token })}
          onClose={() => setPicking(null)}
          onGrabbed={(grabbedTitle) => {
            setPicking(null);
            setStatus(grabbedMessage(grabbedTitle));
          }}
        />
      )}

      {/* Hidden while a dialog is open: clicking a row's Delete or Pick opens it with the mouse still on the row. */}
      {posterPreview.activeKey !== null &&
        !menuOpenOnVisibleRow &&
        !deleting &&
        !picking &&
        visible.some((row) => row.id === posterPreview.activeKey) &&
        posterPreview.preview}

      {isAdmin && deleting && (
        <LibraryDeleteDialog
          items={deleting.movies}
          noun={MOVIE}
          max={MAX_BULK_MOVIES}
          appName="Radarr"
          submit={({ ids, deleteFiles, addExclusion, confirmCount }) =>
            removeMovies({ movieIds: ids, deleteFiles, addImportExclusion: addExclusion, confirmCount })
          }
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}

      <Pagination current={current} pages={pages} onPage={setPage} />
    </div>
  );
}

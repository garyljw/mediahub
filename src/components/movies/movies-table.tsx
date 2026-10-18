"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, BookmarkCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { formatAdded, formatSize } from "./movie-format";

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

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const CELL = "py-1.5 px-2";
const HEAD = "sticky top-0 z-10 h-8 border-b bg-background py-1.5 px-2";
const COLUMN_COUNT = 8;

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

export function MoviesTable({ rows, profiles }: { rows: MovieRow[]; profiles: QualityProfileOption[] }) {
  const [filters, setFilters] = useState<MovieFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const searchRef = useRef<HTMLInputElement>(null);

  // Autofocus the search box on desktop only, so phones don't pop the keyboard.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) searchRef.current?.focus();
  }, []);

  const options = useMemo(() => profileOptions(rows, profiles), [rows, profiles]);
  const filtered = useMemo(() => filterMovies(rows, filters), [rows, filters]);
  const sorted = useMemo(() => sortMovies(filtered, sort), [filtered, sort]);
  const pages = pageCount(sorted.length);
  const current = clampPage(page, sorted.length);
  const visible = pageSlice(sorted, current);

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

  const noun = rows.length === 1 ? "movie" : "movies";

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
          {filtered.length.toLocaleString("en-GB")} of {rows.length.toLocaleString("en-GB")} {noun}
        </p>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-md border">
        <Table className="min-w-[60rem]">
          <TableHeader>
            <TableRow>
              <SortHeader label="Title" sortKey="title" sort={sort} onSort={changeSort} />
              <SortHeader label="Year" sortKey="year" sort={sort} onSort={changeSort} />
              <TableHead className={HEAD}>Status</TableHead>
              <TableHead className={cn(HEAD, "text-center")}>Monitored</TableHead>
              <TableHead className={HEAD}>Quality profile</TableHead>
              <TableHead className={HEAD}>File quality</TableHead>
              <SortHeader label="Size" sortKey="size" sort={sort} onSort={changeSort} align="right" />
              <SortHeader label="Added" sortKey="added" sort={sort} onSort={changeSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.id}>
                <TableCell className={CELL}>
                  <div className="max-w-[28rem] truncate">
                    <span className="font-medium">{row.title}</span>
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

"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { addLibraryMovie, searchMovies } from "@/app/(app)/movies/actions";
import { addLibrarySeries, searchSeries } from "@/app/(app)/tv/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/search-input";
import { GENERIC_ERROR, normalizeTerm, resultLabel } from "@/components/library/add";
import { Poster } from "@/components/poster/poster";
import { AdminPanel } from "@/components/add/admin-add-panel";
import { MIN_TERM_LENGTH } from "@/components/add/add-link";
import { cn } from "@/lib/utils";
import {
  filterByKind,
  mergeResults,
  movieFormFor,
  movieItems,
  seriesFormFor,
  seriesItems,
  type AddItem,
  type AddKind,
  type AddOptionsForApp,
  type MovieForm,
  type MovieFormDefaults,
  type SeriesForm,
  type SeriesFormDefaults,
} from "./add-results";

/** Wait this long after the last keystroke before searching. */
const DEBOUNCE_MS = 400;

const KIND_CHIPS: { kind: AddKind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "movie", label: "Movies" },
  { kind: "series", label: "TV" },
];

const CHIP_CLASS = "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** One app's search reply: its rows, or the message to show in its place. */
type Outcome = { ok: true; items: AddItem[] } | { ok: false; error: string };

/** Both searches for one term. One failing does not hide the other. */
type Results = { movies: Outcome; series: Outcome };

/** Each call catches its own failure, so the two searches never reject. */
async function fetchMovies(term: string): Promise<Outcome> {
  try {
    const response = await searchMovies({ term });
    return response.ok ? { ok: true, items: movieItems(response.results) } : { ok: false, error: response.error };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

async function fetchSeries(term: string): Promise<Outcome> {
  try {
    const response = await searchSeries({ term });
    return response.ok ? { ok: true, items: seriesItems(response.results) } : { ok: false, error: response.error };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * The Add page's search: movies (TMDB through Radarr) and TV (TVDB through Sonarr) together, searched as you type.
 * A requester adds a result at once with the saved defaults. An admin opens a panel with every choice first.
 * Both roles may use it; the server checks the role and the fields on each call.
 */
export function AddSearch({
  isAdmin,
  movieOptions,
  seriesOptions,
  initialQuery,
  initialKind,
}: {
  isAdmin: boolean;
  /** The text to start with, from the address (e.g. when Home jumps here). Searched at once when long enough. */
  initialQuery: string;
  initialKind: AddKind;
  /** Admin only. Null for a requester, or when Radarr's options could not be loaded. */
  movieOptions: AddOptionsForApp<MovieFormDefaults> | null;
  /** Admin only. Null for a requester, or when Sonarr's options could not be loaded. */
  seriesOptions: AddOptionsForApp<SeriesFormDefaults> | null;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<AddKind>(initialKind);
  const [results, setResults] = useState<Results | null>(null);
  const [searching, setSearching] = useState(false);
  // Several rows can be adding at once, so these are sets and maps keyed by row, not single values.
  const [addingKeys, setAddingKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Added rows, with the new id (or null). Kept across searches, so a re-search still shows them as added.
  const [addedKeys, setAddedKeys] = useState<ReadonlyMap<string, number | null>>(() => new Map());
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  // Only one admin panel is open at a time.
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const [movieForm, setMovieForm] = useState<MovieForm | null>(null);
  const [seriesForm, setSeriesForm] = useState<SeriesForm | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Counts searches and keystrokes. A reply whose number is no longer the latest is for an older term, so it is dropped.
  const requestRef = useRef(0);
  const fieldId = useId();

  // Autofocus the search box on desktop only, so phones don't pop the keyboard.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) searchRef.current?.focus();
  }, []);

  // Don't leave a search queued after the page goes away.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  function runSearch(term: string) {
    requestRef.current += 1;
    const requestId = requestRef.current;
    setSearching(true);
    void Promise.all([fetchMovies(term), fetchSeries(term)]).then(([movies, series]) => {
      if (requestRef.current !== requestId) return;
      setResults({ movies, series });
      setSearching(false);
    });
  }

  // A start text searches at once, with no wait, once per mount. Next keeps a hidden Add page alive and runs its effects
  // again on return, so the ref stops a second run from replacing what the user has typed since. (The page gives this
  // component a new key for a new start text, so a new one gets a fresh ref.)
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const term = normalizeTerm(initialQuery);
    if (term === null || term.length < MIN_TERM_LENGTH) return;
    // Started from a microtask rather than in the effect body, as Home's mount effect does. A keystroke or unmount
    // before it runs changes requestRef or sets cancelled, and the start search is skipped.
    // A run cancelled before it started doesn't count, so React's dev double-run of effects still searches.
    const before = requestRef.current;
    let cancelled = false;
    let ran = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      ran = true;
      if (requestRef.current === before) runSearch(term);
    });
    return () => {
      cancelled = true;
      if (!ran) startedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs for the start text only, not on later typing
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Any search still in flight is for the previous text, so its reply is dropped.
    requestRef.current += 1;
    setSearching(false);
    const term = normalizeTerm(value);
    if (term === null || term.length < MIN_TERM_LENGTH) {
      setResults(null);
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runSearch(term);
    }, DEBOUNCE_MS);
  }

  async function runAdd(item: AddItem, input: object) {
    setRowErrors((previous) => {
      const next = new Map(previous);
      next.delete(item.key);
      return next;
    });
    setAddingKeys((previous) => new Set(previous).add(item.key));
    try {
      const response = item.kind === "movie" ? await addLibraryMovie(input) : await addLibrarySeries(input);
      if (response.ok) {
        setAddedKeys((previous) => new Map(previous).set(item.key, response.id));
        setPickingKey((current) => (current === item.key ? null : current));
      } else {
        setRowErrors((previous) => new Map(previous).set(item.key, response.error));
      }
    } catch {
      setRowErrors((previous) => new Map(previous).set(item.key, GENERIC_ERROR));
    } finally {
      // Always clear the row, so a failed call never leaves its buttons disabled.
      setAddingKeys((previous) => {
        const next = new Set(previous);
        next.delete(item.key);
        return next;
      });
    }
  }

  function openPanel(item: AddItem) {
    setPickingKey(item.key);
    if (item.kind === "movie") setMovieForm(movieOptions === null ? null : movieFormFor(movieOptions));
    else setSeriesForm(seriesOptions === null ? null : seriesFormFor(seriesOptions));
  }

  const movieRows = results?.movies.ok ? results.movies.items : [];
  const seriesRows = results?.series.ok ? results.series.items : [];
  const merged = mergeResults(movieRows, seriesRows);
  const visible = filterByKind(merged, kind);
  const bothSearched = results !== null && results.movies.ok && results.series.ok;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput
          ref={searchRef}
          onClear={() => onQueryChange("")}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search movies and TV to add"
          aria-label="Search movies and TV to add"
          maxLength={100}
          className="sm:max-w-sm"
        />
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {KIND_CHIPS.map((chip) => (
            <button
              key={chip.kind}
              type="button"
              aria-pressed={kind === chip.kind}
              onClick={() => setKind(chip.kind)}
              className={cn(
                CHIP_CLASS,
                kind === chip.kind
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-accent",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {searching && (
        <p role="status" className="text-sm text-muted-foreground">
          Searching…
        </p>
      )}
      {results !== null && !results.movies.ok && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t search movies: {results.movies.error}
        </p>
      )}
      {results !== null && !results.series.ok && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t search TV: {results.series.error}
        </p>
      )}
      {bothSearched && merged.length === 0 && <p className="text-sm text-muted-foreground">No results.</p>}
      {merged.length > 0 && visible.length === 0 && kind !== "all" && (
        <p className="text-sm text-muted-foreground">{kind === "movie" ? "No movies in these results." : "No TV in these results."}</p>
      )}

      {visible.length > 0 && (
        <ul className="divide-y rounded-md border">
          {visible.map((item) => {
            const isAdded = addedKeys.has(item.key);
            const addedId = addedKeys.get(item.key) ?? null;
            const adding = addingKeys.has(item.key);
            const rowError = rowErrors.get(item.key);
            const open = isAdmin && pickingKey === item.key;
            const appName = item.kind === "movie" ? "Radarr" : "Sonarr";
            const openHref = addedId === null ? null : item.kind === "movie" ? `/movies/${addedId}` : `/tv/${addedId}`;
            const label = resultLabel(item);
            const idBase = `${fieldId}-${item.key}`;

            return (
              <li key={item.key} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex w-20 shrink-0 flex-col items-start gap-1.5">
                    {isAdded ? (
                      <>
                        <Badge variant="secondary">Added</Badge>
                        {openHref !== null && (
                          <Link href={openHref} className="text-sm font-medium underline">
                            Open
                          </Link>
                        )}
                      </>
                    ) : item.inLibrary ? (
                      <Badge variant="secondary">In library</Badge>
                    ) : isAdmin ? (
                      !open && (
                        <Button size="sm" variant="outline" aria-label={`Add ${label}…`} disabled={adding} onClick={() => openPanel(item)}>
                          Add…
                        </Button>
                      )
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Add ${label}`}
                        disabled={adding}
                        aria-busy={adding}
                        onClick={() =>
                          void runAdd(item, item.kind === "movie" ? { tmdbId: item.externalId } : { tvdbId: item.externalId })
                        }
                      >
                        {adding ? "Adding…" : "Add"}
                      </Button>
                    )}
                  </div>
                  <Poster src={item.posterSrc} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {label}
                      <Badge variant="outline" className="ml-2 align-middle">
                        {item.kind === "movie" ? "Movie" : "TV"}
                      </Badge>
                    </p>
                    {item.network !== null && <p className="text-sm text-muted-foreground">{item.network}</p>}
                    {item.overview !== "" && <p className="line-clamp-3 text-sm text-muted-foreground">{item.overview}</p>}
                  </div>
                </div>

                {open && (
                  <AdminPanel
                    kind={item.kind}
                    appName={appName}
                    idBase={idBase}
                    adding={adding}
                    movieOptions={movieOptions}
                    seriesOptions={seriesOptions}
                    movieForm={movieForm}
                    seriesForm={seriesForm}
                    setMovieForm={setMovieForm}
                    setSeriesForm={setSeriesForm}
                    onCancel={() => setPickingKey(null)}
                    onAdd={() => {
                      if (item.kind === "movie") {
                        if (movieForm === null || movieForm.profileId === null || movieForm.rootFolderId === null) return;
                        void runAdd(item, {
                          tmdbId: item.externalId,
                          qualityProfileId: movieForm.profileId,
                          rootFolderId: movieForm.rootFolderId,
                          monitored: movieForm.monitored,
                          searchForMovie: movieForm.searchForMovie,
                        });
                      } else {
                        if (seriesForm === null || seriesForm.profileId === null || seriesForm.rootFolderId === null) return;
                        void runAdd(item, {
                          tvdbId: item.externalId,
                          qualityProfileId: seriesForm.profileId,
                          rootFolderId: seriesForm.rootFolderId,
                          monitor: seriesForm.monitor,
                          seriesType: seriesForm.seriesType,
                          seasonFolder: seriesForm.seasonFolder,
                          searchForMissingEpisodes: seriesForm.searchForMissingEpisodes,
                        });
                      }
                    }}
                  />
                )}

                {rowError !== undefined && (
                  <p role="alert" className="mt-2 text-sm text-destructive">
                    {rowError}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { addLibraryMovie, searchMovies } from "@/app/(app)/movies/actions";
import { addLibrarySeries, searchSeries } from "@/app/(app)/tv/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SELECT_CLASS } from "@/components/library/table-parts";
import { GENERIC_ERROR, normalizeTerm, resultLabel } from "@/components/library/add";
import { Poster } from "@/components/poster/poster";
import { usePosterPreview } from "@/components/poster/use-poster-preview";
import {
  MONITOR_LABELS,
  SERIES_MONITOR_OPTIONS,
  SERIES_TYPE_LABELS,
  SERIES_TYPE_OPTIONS,
} from "@/components/tv/series-add";
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
/** Shorter terms are not searched. */
const MIN_TERM_LENGTH = 2;

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
}: {
  isAdmin: boolean;
  /** Admin only. Null for a requester, or when Radarr's options could not be loaded. */
  movieOptions: AddOptionsForApp<MovieFormDefaults> | null;
  /** Admin only. Null for a requester, or when Sonarr's options could not be loaded. */
  seriesOptions: AddOptionsForApp<SeriesFormDefaults> | null;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AddKind>("all");
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
  const posterPreview = usePosterPreview<string>();
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          ref={searchRef}
          type="search"
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
              <li key={item.key} className="p-3" {...posterPreview.rowHandlers(item.key, item.posterSrc)}>
                <div className="flex items-start gap-3">
                  <Poster src={item.posterSrc} />
                  <div className="min-w-0 flex-1" data-poster-anchor>
                    <p className="font-medium">
                      {label}
                      <Badge variant="outline" className="ml-2 align-middle">
                        {item.kind === "movie" ? "Movie" : "TV"}
                      </Badge>
                    </p>
                    {item.network !== null && <p className="text-sm text-muted-foreground">{item.network}</p>}
                    {item.overview !== "" && <p className="line-clamp-2 text-sm text-muted-foreground">{item.overview}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
      {posterPreview.preview}
    </div>
  );
}

/**
 * The admin's panel under a row: every choice the add takes, starting on the saved defaults. Movies get profile,
 * folder, monitored and search. TV gets profile, folder, monitor, series type, season folders and search.
 */
function AdminPanel({
  kind,
  appName,
  idBase,
  adding,
  movieOptions,
  seriesOptions,
  movieForm,
  seriesForm,
  setMovieForm,
  setSeriesForm,
  onCancel,
  onAdd,
}: {
  kind: AddItem["kind"];
  appName: "Radarr" | "Sonarr";
  idBase: string;
  adding: boolean;
  movieOptions: AddOptionsForApp<MovieFormDefaults> | null;
  seriesOptions: AddOptionsForApp<SeriesFormDefaults> | null;
  movieForm: MovieForm | null;
  seriesForm: SeriesForm | null;
  setMovieForm: (update: (form: MovieForm | null) => MovieForm | null) => void;
  setSeriesForm: (update: (form: SeriesForm | null) => SeriesForm | null) => void;
  onCancel: () => void;
  onAdd: () => void;
}) {
  const options = kind === "movie" ? movieOptions : seriesOptions;
  const form = kind === "movie" ? movieForm : seriesForm;
  const ready = options !== null && form !== null && form.profileId !== null && form.rootFolderId !== null;

  return (
    <div className="mt-3 space-y-3 rounded-md border p-3">
      {options === null ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load options from {appName}.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            id={`${idBase}-profile`}
            label="Quality profile"
            value={form === null || form.profileId === null ? "" : String(form.profileId)}
            onChange={(value) => {
              const profileId = Number(value);
              if (kind === "movie") setMovieForm((current) => current && { ...current, profileId });
              else setSeriesForm((current) => current && { ...current, profileId });
            }}
            disabled={adding}
          >
            {options.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            id={`${idBase}-folder`}
            label="Root folder"
            value={form === null || form.rootFolderId === null ? "" : String(form.rootFolderId)}
            onChange={(value) => {
              const rootFolderId = Number(value);
              if (kind === "movie") setMovieForm((current) => current && { ...current, rootFolderId });
              else setSeriesForm((current) => current && { ...current, rootFolderId });
            }}
            disabled={adding}
          >
            {options.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.path}
              </option>
            ))}
          </SelectField>

          {kind === "movie" && movieForm !== null && (
            <>
              <CheckField
                id={`${idBase}-monitored`}
                label="Monitored"
                checked={movieForm.monitored}
                onChange={(checked) => setMovieForm((current) => current && { ...current, monitored: checked })}
                disabled={adding}
              />
              <CheckField
                id={`${idBase}-search`}
                label="Search on add"
                checked={movieForm.searchForMovie}
                onChange={(checked) => setMovieForm((current) => current && { ...current, searchForMovie: checked })}
                disabled={adding}
              />
            </>
          )}

          {kind === "series" && seriesForm !== null && (
            <>
              <SelectField
                id={`${idBase}-monitor`}
                label="Monitor"
                value={seriesForm.monitor}
                onChange={(value) => {
                  const monitor = SERIES_MONITOR_OPTIONS.find((choice) => choice === value);
                  if (monitor !== undefined) setSeriesForm((current) => current && { ...current, monitor });
                }}
                disabled={adding}
              >
                {SERIES_MONITOR_OPTIONS.map((choice) => (
                  <option key={choice} value={choice}>
                    {MONITOR_LABELS[choice]}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id={`${idBase}-type`}
                label="Series type"
                value={seriesForm.seriesType}
                onChange={(value) => {
                  const seriesType = SERIES_TYPE_OPTIONS.find((choice) => choice === value);
                  if (seriesType !== undefined) setSeriesForm((current) => current && { ...current, seriesType });
                }}
                disabled={adding}
              >
                {SERIES_TYPE_OPTIONS.map((choice) => (
                  <option key={choice} value={choice}>
                    {SERIES_TYPE_LABELS[choice]}
                  </option>
                ))}
              </SelectField>
              <CheckField
                id={`${idBase}-season-folders`}
                label="Season folders"
                checked={seriesForm.seasonFolder}
                onChange={(checked) => setSeriesForm((current) => current && { ...current, seasonFolder: checked })}
                disabled={adding}
              />
              <CheckField
                id={`${idBase}-search`}
                label="Search on add"
                checked={seriesForm.searchForMissingEpisodes}
                onChange={(checked) => setSeriesForm((current) => current && { ...current, searchForMissingEpisodes: checked })}
                disabled={adding}
              />
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onAdd} disabled={adding || !ready} aria-busy={adding}>
          {adding ? "Adding…" : "Add"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={adding}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={SELECT_CLASS}>
        {children}
      </select>
    </div>
  );
}

function CheckField({
  id,
  label,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-primary"
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

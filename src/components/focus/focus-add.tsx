"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addFocusItem, addNewToFocus, searchFocusTitles, type FocusResult } from "@/app/(app)/focus/actions";
import { AdminPanel } from "@/components/add/admin-add-panel";
import {
  movieFormFor,
  seriesFormFor,
  type AddOptionsForApp,
  type MovieForm,
  type MovieFormDefaults,
  type SeriesForm,
  type SeriesFormDefaults,
} from "@/components/add/add-results";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HomeItem } from "@/components/home/home-items";
import { GENERIC_ERROR, resultLabel } from "@/components/library/add";
import { Poster } from "@/components/poster/poster";
import { usePosterPreview } from "@/components/poster/use-poster-preview";
import type { TitleHit } from "@/server/title-search";
import { FOCUS_APP, FOCUS_NAME, type FocusKind } from "./focus-kinds";
import { libraryMatches, libraryRowKey, remoteRowKey, remoteTerm } from "./focus-add-items";

/** Wait this long after the last keystroke before searching. */
const DEBOUNCE_MS = 400;

/** One remote search's reply: its hits, or the message to show in their place. */
type Outcome = { ok: true; hits: TitleHit[] } | { ok: false; error: string };

/** Each call catches its own failure, so the search never rejects. */
async function fetchHits(kind: FocusKind, term: string): Promise<Outcome> {
  try {
    const response = await searchFocusTitles({ kind, term });
    return response.ok ? { ok: true, hits: response.hits } : { ok: false, error: response.error };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * The search box above a Focus list. Two sections: titles in the library that aren't in this list yet (matched as you
 * type, ten at most), then titles not downloaded yet (TMDB or TVDB through Radarr or Sonarr, searched after a short
 * pause). Adding a title adds it to its app and to the list. A requester adds at once with the saved defaults; an admin
 * opens the same panel as the Add page first. The server checks the role and every field on each call.
 */
export function FocusAdd({
  kind,
  isAdmin,
  candidates,
  movieOptions,
  seriesOptions,
}: {
  kind: FocusKind;
  isAdmin: boolean;
  /** Library titles that aren't in this list. The page builds them, and this component filters them. */
  candidates: HomeItem[];
  /** Admin only, for the panel. Null for a requester, or when Radarr's options could not be loaded. */
  movieOptions: AddOptionsForApp<MovieFormDefaults> | null;
  /** Admin only, for the panel. Null for a requester, or when Sonarr's options could not be loaded. */
  seriesOptions: AddOptionsForApp<SeriesFormDefaults> | null;
}) {
  const router = useRouter();
  const name = FOCUS_NAME[kind];
  const app = FOCUS_APP[kind];
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Outcome | null>(null);
  const [searching, setSearching] = useState(false);
  // Several rows can be adding at once, so these are sets and maps keyed by row, not single values.
  const [addingKeys, setAddingKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Rows that were added. Kept across searches, so a re-search still shows them as added.
  const [addedKeys, setAddedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  // Only one admin panel is open at a time.
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const [movieForm, setMovieForm] = useState<MovieForm | null>(null);
  const [seriesForm, setSeriesForm] = useState<SeriesForm | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Counts searches and keystrokes. A reply whose number is no longer the latest is for an older term, so it is dropped.
  const requestRef = useRef(0);
  const posterPreview = usePosterPreview<string>();
  const fieldId = useId();

  // Don't leave a search queued after the page goes away.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const trimmed = query.trim();
  const libraryRows = libraryMatches(candidates, kind, query);
  const term = remoteTerm(query);

  function runSearch(searchTerm: string) {
    requestRef.current += 1;
    const requestId = requestRef.current;
    setSearching(true);
    void fetchHits(kind, searchTerm).then((outcome) => {
      if (requestRef.current !== requestId) return;
      setRemote(outcome);
      setSearching(false);
    });
  }

  function onQueryChange(value: string) {
    setQuery(value);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Any search still in flight is for the previous text, so its reply is dropped. Its hits are cleared too, so no
    // Add button is live for a title that doesn't match the box. "Searching…" shows until the new reply arrives.
    requestRef.current += 1;
    setRemote(null);
    const next = remoteTerm(value);
    setSearching(next !== null);
    if (next === null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runSearch(next);
    }, DEBOUNCE_MS);
  }

  /** Runs one add for a row. A success marks the row and refreshes the page, so the grid and the library show it. */
  async function runAdd(key: string, request: () => Promise<FocusResult>) {
    setRowErrors((previous) => {
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
    setAddingKeys((previous) => new Set(previous).add(key));
    try {
      const response = await request();
      if (response.ok) {
        setAddedKeys((previous) => new Set(previous).add(key));
        setPickingKey((current) => (current === key ? null : current));
        router.refresh();
      } else {
        setRowErrors((previous) => new Map(previous).set(key, response.error));
        // The title is in the library now, so the row must not offer the add again, and the page reloads to show it.
        if (response.addedToLibrary) {
          setAddedKeys((previous) => new Set(previous).add(key));
          setPickingKey((current) => (current === key ? null : current));
          router.refresh();
        }
      }
    } catch {
      setRowErrors((previous) => new Map(previous).set(key, GENERIC_ERROR));
    } finally {
      // Always clear the row, so a failed call never leaves its buttons disabled.
      setAddingKeys((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  }

  function openPanel(key: string) {
    setPickingKey(key);
    if (kind === "movie") setMovieForm(movieOptions === null ? null : movieFormFor(movieOptions));
    else setSeriesForm(seriesOptions === null ? null : seriesFormFor(seriesOptions));
  }

  /** The admin's full add for a hit, from the panel's fields. Null while the panel isn't ready. */
  function adminAddInput(hit: TitleHit): unknown {
    if (kind === "movie") {
      if (movieForm === null || movieForm.profileId === null || movieForm.rootFolderId === null) return null;
      return {
        kind,
        add: {
          tmdbId: hit.externalId,
          qualityProfileId: movieForm.profileId,
          rootFolderId: movieForm.rootFolderId,
          monitored: movieForm.monitored,
          searchForMovie: movieForm.searchForMovie,
        },
      };
    }
    if (seriesForm === null || seriesForm.profileId === null || seriesForm.rootFolderId === null) return null;
    return {
      kind,
      add: {
        tvdbId: hit.externalId,
        qualityProfileId: seriesForm.profileId,
        rootFolderId: seriesForm.rootFolderId,
        monitor: seriesForm.monitor,
        seriesType: seriesForm.seriesType,
        seasonFolder: seriesForm.seasonFolder,
        searchForMissingEpisodes: seriesForm.searchForMissingEpisodes,
      },
    };
  }

  const hits = remote !== null && remote.ok ? remote.hits : [];

  return (
    <div className="space-y-4">
      <Input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={`Add to ${name}`}
        aria-label={`Add to ${name}`}
        maxLength={100}
        className="sm:max-w-sm"
      />

      {trimmed !== "" && (
        <section aria-labelledby={`${fieldId}-library`} className="space-y-2">
          <h2 id={`${fieldId}-library`} className="text-sm font-medium text-muted-foreground">
            In your library
          </h2>
          {libraryRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No titles in your library match.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {libraryRows.map((item) => {
                const key = libraryRowKey(item);
                const adding = addingKeys.has(key);
                const added = addedKeys.has(key);
                const rowError = rowErrors.get(key);
                const label = resultLabel(item);
                return (
                  <li key={key} className="p-3" {...posterPreview.rowHandlers(key, item.posterSrc)}>
                    <div className="flex items-center gap-3">
                      <Poster src={item.posterSrc} />
                      <div className="min-w-0 flex-1" data-poster-anchor>
                        <p className="font-medium">{label}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {added ? (
                          <Badge variant="secondary">Added</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Add ${label} to ${name}`}
                            disabled={adding}
                            aria-busy={adding}
                            onClick={() => void runAdd(key, () => addFocusItem({ kind, id: item.id }))}
                          >
                            {adding ? "Adding…" : "Add"}
                          </Button>
                        )}
                      </div>
                    </div>
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
        </section>
      )}

      {term !== null && (
        <section aria-labelledby={`${fieldId}-remote`} className="space-y-2">
          <h2 id={`${fieldId}-remote`} className="text-sm font-medium text-muted-foreground">
            Not downloaded yet
          </h2>
          {searching && (
            <p role="status" className="text-sm text-muted-foreground">
              Searching…
            </p>
          )}
          {!searching && remote !== null && !remote.ok && (
            <p role="alert" className="text-sm text-destructive">
              {remote.error}
            </p>
          )}
          {!searching && remote !== null && remote.ok && hits.length === 0 && (
            <p className="text-sm text-muted-foreground">No results.</p>
          )}
          {hits.length > 0 && (
            <ul className="divide-y rounded-md border">
              {hits.map((hit) => {
                const key = remoteRowKey(hit);
                const adding = addingKeys.has(key);
                const added = addedKeys.has(key);
                const rowError = rowErrors.get(key);
                const open = isAdmin && pickingKey === key;
                const label = resultLabel(hit);
                const idBase = `${fieldId}-${key}`;
                return (
                  <li key={key} className="p-3" {...posterPreview.rowHandlers(key, hit.posterSrc)}>
                    <div className="flex items-start gap-3">
                      <Poster src={hit.posterSrc} />
                      <div className="min-w-0 flex-1" data-poster-anchor>
                        <p className="font-medium">{label}</p>
                        {hit.network !== null && <p className="text-sm text-muted-foreground">{hit.network}</p>}
                        {hit.overview !== "" && <p className="line-clamp-2 text-sm text-muted-foreground">{hit.overview}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        {added ? (
                          <Badge variant="secondary">Added</Badge>
                        ) : isAdmin ? (
                          !open && (
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`Add ${label} to ${name}…`}
                              disabled={adding}
                              onClick={() => openPanel(key)}
                            >
                              Add…
                            </Button>
                          )
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Add ${label} to ${name}`}
                            disabled={adding}
                            aria-busy={adding}
                            onClick={() =>
                              void runAdd(key, () =>
                                addNewToFocus({
                                  kind,
                                  add: kind === "movie" ? { tmdbId: hit.externalId } : { tvdbId: hit.externalId },
                                }),
                              )
                            }
                          >
                            {adding ? "Adding…" : "Add"}
                          </Button>
                        )}
                      </div>
                    </div>

                    {open && (
                      <AdminPanel
                        kind={kind}
                        appName={app}
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
                          const input = adminAddInput(hit);
                          if (input !== null) void runAdd(key, () => addNewToFocus(input));
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
        </section>
      )}
      {posterPreview.preview}
    </div>
  );
}

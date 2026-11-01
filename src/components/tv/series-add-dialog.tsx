"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { addLibrarySeries, searchSeries } from "@/app/(app)/tv/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SeriesLookupResult } from "@/server/arr/series-add";
import type { RootFolderOption } from "@/server/arr/root-folders";
import type { QualityProfileOption } from "@/server/arr/profiles";
import { SELECT_CLASS } from "@/components/library/table-parts";
import {
  GENERIC_ERROR,
  MAX_TERM_LENGTH,
  addedMessage,
  folderLabel,
  normalizeTerm,
  resultLabel,
} from "@/components/library/add";
import { Poster } from "@/components/poster/poster";
import { usePosterPreview } from "@/components/poster/use-poster-preview";
import {
  MONITOR_LABELS,
  SERIES_MONITOR_OPTIONS,
  SERIES_TYPE_LABELS,
  SERIES_TYPE_OPTIONS,
  buildSeriesAddRequest,
  defaultSeriesOptions,
  isSeriesInLibrary,
  type SeriesAddOptions,
} from "./series-add";

/** A search result's thumbnail, from MediaHub's lookup route. Null when TVDB had no usable poster. */
function lookupPosterSrc(result: SeriesLookupResult): string | null {
  return result.posterPath === null ? null : `/api/tv/lookup-poster/${result.posterPath}`;
}

/**
 * "Add series" button and its dialog. Search TVDB through Sonarr, then add a result with the chosen
 * profile, root folder, monitor, series type and search flag. Both roles may use it; the server checks
 * the role on each call.
 */
export function SeriesAddDialog({
  profiles,
  rootFolders,
}: {
  profiles: QualityProfileOption[];
  /** null when Sonarr's root folders could not be loaded. Series can't be added then, but search still works. */
  rootFolders: RootFolderOption[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SeriesLookupResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [options, setOptions] = useState<SeriesAddOptions>(() => defaultSeriesOptions(profiles, rootFolders));
  // Series added during this opening. They show "In library" even though the search results are older.
  const [addedIds, setAddedIds] = useState<Set<number>>(() => new Set());
  // Several rows can be adding at once, so this is a set, not one id.
  const [addingIds, setAddingIds] = useState<Set<number>>(() => new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const posterPreview = usePosterPreview<number>();

  const queryId = useId();
  const profileSelectId = useId();
  const folderSelectId = useId();
  const monitorSelectId = useId();
  const typeSelectId = useId();
  const searchFlagId = useId();
  const errorId = useId();

  const busy = searching || addingIds.size > 0;
  const canAdd = rootFolders !== null && options.profileId !== null && options.rootFolderId !== null;

  function openDialog() {
    // Each opening starts fresh, with the default options, like the movie dialog.
    posterPreview.clear();
    setQuery("");
    setResults(null);
    setSearchError(null);
    setAddedIds(new Set());
    setAddError(null);
    setStatus(null);
    setOptions(defaultSeriesOptions(profiles, rootFolders));
    setOpen(true);
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = normalizeTerm(query);
    if (term === null) return;
    setSearchError(null);
    posterPreview.clear();
    startSearch(async () => {
      try {
        const response = await searchSeries({ term });
        if (response.ok) setResults(response.results);
        else setSearchError(response.error);
      } catch {
        setSearchError(GENERIC_ERROR);
      }
    });
  }

  async function add(result: SeriesLookupResult) {
    const request = buildSeriesAddRequest(result.tvdbId, options);
    if (request === null) return;
    setAddError(null);
    setStatus(null);
    setAddingIds((previous) => new Set(previous).add(result.tvdbId));
    try {
      const response = await addLibrarySeries(request);
      if (response.ok) {
        setAddedIds((previous) => new Set(previous).add(result.tvdbId));
        setStatus(addedMessage(response));
      } else {
        setAddError(response.error);
      }
    } catch {
      setAddError(GENERIC_ERROR);
    } finally {
      // Always clear the row, so a failed call never leaves its button stuck on "Adding…".
      setAddingIds((previous) => {
        const next = new Set(previous);
        next.delete(result.tvdbId);
        return next;
      });
    }
  }

  return (
    <>
      <Button onClick={openDialog}>Add series</Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Don't close while a search or add is in flight, so its outcome is never shown to nobody.
          if (!next && !busy) {
            posterPreview.clear();
            setOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add series</DialogTitle>
            <DialogDescription>Search by title, then add a result to the library.</DialogDescription>
          </DialogHeader>

          <form className="flex gap-2" role="search" onSubmit={search}>
            <label htmlFor={queryId} className="sr-only">
              Series title
            </label>
            <Input
              id={queryId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Series title…"
              maxLength={MAX_TERM_LENGTH}
              disabled={searching}
              className="h-9"
            />
            <Button type="submit" disabled={normalizeTerm(query) === null || searching} aria-busy={searching}>
              {searching ? "Searching…" : "Search"}
            </Button>
          </form>

          {searchError && (
            <p role="alert" className="text-sm text-destructive">
              {searchError}
            </p>
          )}

          <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">Add options</legend>
            {rootFolders === null ? (
              <p role="alert" className="text-sm text-destructive sm:col-span-2">
                Couldn&apos;t load root folders from Sonarr, so series can&apos;t be added right now.
              </p>
            ) : rootFolders.length === 0 ? (
              <p className="text-sm text-destructive sm:col-span-2">
                Sonarr has no root folders set up, so series can&apos;t be added yet.
              </p>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <label htmlFor={profileSelectId} className="text-sm font-medium">
                    Quality profile
                  </label>
                  <select
                    id={profileSelectId}
                    value={options.profileId === null ? "" : String(options.profileId)}
                    onChange={(e) => setOptions({ ...options, profileId: Number(e.target.value) })}
                    className={SELECT_CLASS}
                  >
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor={folderSelectId} className="text-sm font-medium">
                    Root folder
                  </label>
                  <select
                    id={folderSelectId}
                    value={options.rootFolderId === null ? "" : String(options.rootFolderId)}
                    onChange={(e) => setOptions({ ...options, rootFolderId: Number(e.target.value) })}
                    className={SELECT_CLASS}
                  >
                    {rootFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folderLabel(folder)}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <label htmlFor={monitorSelectId} className="text-sm font-medium">
                Monitor
              </label>
              <select
                id={monitorSelectId}
                value={options.monitor}
                onChange={(e) => {
                  const monitor = SERIES_MONITOR_OPTIONS.find((choice) => choice === e.target.value);
                  if (monitor !== undefined) setOptions({ ...options, monitor });
                }}
                className={SELECT_CLASS}
              >
                {SERIES_MONITOR_OPTIONS.map((choice) => (
                  <option key={choice} value={choice}>
                    {MONITOR_LABELS[choice]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={typeSelectId} className="text-sm font-medium">
                Series type
              </label>
              <select
                id={typeSelectId}
                value={options.seriesType}
                onChange={(e) => {
                  const seriesType = SERIES_TYPE_OPTIONS.find((choice) => choice === e.target.value);
                  if (seriesType !== undefined) setOptions({ ...options, seriesType });
                }}
                className={SELECT_CLASS}
              >
                {SERIES_TYPE_OPTIONS.map((choice) => (
                  <option key={choice} value={choice}>
                    {SERIES_TYPE_LABELS[choice]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <input
                id={searchFlagId}
                type="checkbox"
                checked={options.searchForMissingEpisodes}
                onChange={(e) => setOptions({ ...options, searchForMissingEpisodes: e.target.checked })}
                className="size-4 accent-primary"
              />
              <label htmlFor={searchFlagId}>Start search for missing episodes</label>
            </div>
          </fieldset>

          <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
            {status}
          </p>
          {addError && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {addError}
            </p>
          )}

          {results !== null && results.length === 0 && (
            <p className="text-sm text-muted-foreground">No series matched that search.</p>
          )}
          {results !== null && results.length > 0 && (
            <ul
              className="max-h-[50vh] divide-y overflow-y-auto rounded-md border"
              onScroll={() => posterPreview.clear()}
            >
              {results.map((result) => {
                const inLibrary = isSeriesInLibrary(result, addedIds);
                const adding = addingIds.has(result.tvdbId);
                return (
                  <li
                    key={result.tvdbId}
                    className="flex items-start gap-3 p-3"
                    {...posterPreview.rowHandlers(result.tvdbId, lookupPosterSrc(result))}
                  >
                    <Poster src={lookupPosterSrc(result)} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {resultLabel(result)}
                        {result.network !== null && (
                          <span className="font-normal text-muted-foreground"> · {result.network}</span>
                        )}
                      </p>
                      {result.overview && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">{result.overview}</p>
                      )}
                    </div>
                    {inLibrary ? (
                      <Badge variant="secondary">In library</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Add ${resultLabel(result)}`}
                        disabled={!canAdd || adding}
                        aria-busy={adding}
                        onClick={() => add(result)}
                      >
                        {adding ? "Adding…" : "Add"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {posterPreview.preview}
        </DialogContent>
      </Dialog>
    </>
  );
}

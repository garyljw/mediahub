"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { addLibraryMovie, searchMovies } from "@/app/(app)/movies/actions";
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
import type { LookupResult, RootFolderOption } from "@/server/arr/movie-add";
import type { QualityProfileOption } from "@/server/arr/movies";
import { SELECT_CLASS } from "./movie-edit-dialog";
import { MoviePoster } from "./movie-poster";
import {
  GENERIC_ERROR,
  addedMessage,
  buildAddRequest,
  defaultOptions,
  folderLabel,
  isInLibrary,
  normalizeTerm,
  resultLabel,
  type AddOptions,
} from "./movie-add";

/**
 * "Add movie" button and its dialog. Search TMDB through Radarr, then add a result with the chosen
 * profile, root folder and checkboxes. Both roles may use it; the server checks the role on each call.
 */
export function MovieAddDialog({
  profiles,
  rootFolders,
}: {
  profiles: QualityProfileOption[];
  /** null when Radarr's root folders could not be loaded. Movies can't be added then, but search still works. */
  rootFolders: RootFolderOption[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LookupResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [options, setOptions] = useState<AddOptions>(() => defaultOptions(profiles, rootFolders));
  // Movies added during this opening. They show "In library" even though the search results are older.
  const [addedIds, setAddedIds] = useState<Set<number>>(() => new Set());
  // Several rows can be adding at once, so this is a set, not one id.
  const [addingIds, setAddingIds] = useState<Set<number>>(() => new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const queryId = useId();
  const profileSelectId = useId();
  const folderSelectId = useId();
  const monitoredId = useId();
  const searchFlagId = useId();
  const errorId = useId();

  const busy = searching || addingIds.size > 0;
  const canAdd = rootFolders !== null && options.profileId !== null && options.rootFolderId !== null;

  function openDialog() {
    // Each opening starts fresh, with the default options, like the edit dialog.
    setQuery("");
    setResults(null);
    setSearchError(null);
    setAddedIds(new Set());
    setAddError(null);
    setStatus(null);
    setOptions(defaultOptions(profiles, rootFolders));
    setOpen(true);
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = normalizeTerm(query);
    if (term === null) return;
    setSearchError(null);
    startSearch(async () => {
      try {
        const response = await searchMovies({ term });
        if (response.ok) setResults(response.results);
        else setSearchError(response.error);
      } catch {
        setSearchError(GENERIC_ERROR);
      }
    });
  }

  async function add(result: LookupResult) {
    const request = buildAddRequest(result.tmdbId, options);
    if (request === null) return;
    setAddError(null);
    setStatus(null);
    setAddingIds((previous) => new Set(previous).add(result.tmdbId));
    try {
      const response = await addLibraryMovie(request);
      if (response.ok) {
        setAddedIds((previous) => new Set(previous).add(result.tmdbId));
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
        next.delete(result.tmdbId);
        return next;
      });
    }
  }

  return (
    <>
      <Button onClick={openDialog}>Add movie</Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Don't close while a search or add is in flight, so its outcome is never shown to nobody.
          if (!next && !busy) setOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add movie</DialogTitle>
            <DialogDescription>Search by title, then add a result to the library.</DialogDescription>
          </DialogHeader>

          <form className="flex gap-2" role="search" onSubmit={search}>
            <label htmlFor={queryId} className="sr-only">
              Movie title
            </label>
            <Input
              id={queryId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Movie title…"
              maxLength={100}
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
                Couldn&apos;t load root folders from Radarr, so movies can&apos;t be added right now.
              </p>
            ) : rootFolders.length === 0 ? (
              <p className="text-sm text-destructive sm:col-span-2">
                Radarr has no root folders set up, so movies can&apos;t be added yet.
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
            <div className="flex items-center gap-2 text-sm">
              <input
                id={monitoredId}
                type="checkbox"
                checked={options.monitored}
                onChange={(e) => setOptions({ ...options, monitored: e.target.checked })}
                className="size-4 accent-primary"
              />
              <label htmlFor={monitoredId}>Monitored</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <input
                id={searchFlagId}
                type="checkbox"
                checked={options.searchForMovie}
                onChange={(e) => setOptions({ ...options, searchForMovie: e.target.checked })}
                className="size-4 accent-primary"
              />
              <label htmlFor={searchFlagId}>Search for movie on add</label>
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
            <p className="text-sm text-muted-foreground">No movies matched that search.</p>
          )}
          {results !== null && results.length > 0 && (
            <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
              {results.map((result) => {
                const inLibrary = isInLibrary(result, addedIds);
                const adding = addingIds.has(result.tmdbId);
                return (
                  <li key={result.tmdbId} className="flex items-start gap-3 p-3">
                    <MoviePoster
                      src={result.posterFile === null ? null : `/api/movies/lookup-poster/${result.posterFile}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{resultLabel(result)}</p>
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
        </DialogContent>
      </Dialog>
    </>
  );
}

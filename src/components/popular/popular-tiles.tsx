"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { addLibraryMovie } from "@/app/(app)/movies/actions";
import { addPopularSeries } from "@/app/(app)/popular/actions";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GENERIC_ERROR, resultLabel } from "@/components/library/add";
import { PosterTile } from "@/components/poster/poster";
import { useTilePeek, type TilePeekItem } from "@/components/home/tile-peek";
import { POSTER_GRID_CLASS, POSTER_TILE_CLASS } from "@/components/poster/poster-grid";
import { usePopularPlace } from "./popular-place";
import type { PopularSectionId } from "./popular-sections";
import type { PopularTile } from "@/server/merge/popular";

/** The same poster route serves movie and TV posters: both are bare TMDB file names. */
function posterSrc(tile: PopularTile): string | null {
  return tile.posterFile === null ? null : `/api/movies/lookup-poster/${tile.posterFile}`;
}

function tileKey(tile: PopularTile): string {
  return `${tile.kind}-${tile.tmdbId}`;
}

/** The TMDB preview page for a title that isn't in the library. */
function previewHref(tile: PopularTile): string {
  return `/popular/${tile.kind === "movie" ? "movie" : "tv"}/${tile.tmdbId}`;
}

function itemHref(kind: PopularTile["kind"], id: number): string {
  return kind === "movie" ? `/movies/${id}` : `/tv/${id}`;
}

function peekItemsOf(tiles: PopularTile[]): Map<string, TilePeekItem> {
  return new Map(
    tiles.map((t) => [
      tileKey(t),
      { key: tileKey(t), kind: t.kind, id: t.tmdbId, title: t.title, posterSrc: posterSrc(t), peek: t.peek },
    ]),
  );
}

/**
 * One list of Popular tiles. A title in the library links to its page. Any other has an Add button: a requester adds at
 * once with the saved defaults, and an admin opens the Add page's panel with every choice first. The server checks the
 * role and every field on each call, and the add refreshes the page, so the tile also flips to "In library" at once here.
 */
export function PopularTiles({
  section,
  tiles,
  isAdmin,
  movieOptions,
  seriesOptions,
}: {
  /** Which section these tiles are in. The same title can be in two sections, so tile places are keyed by it. */
  section: PopularSectionId;
  tiles: PopularTile[];
  isAdmin: boolean;
  /** Admin only. Null for a requester, or when Radarr's options could not be loaded. */
  movieOptions: AddOptionsForApp<MovieFormDefaults> | null;
  /** Admin only. Null for a requester, or when Sonarr's options could not be loaded. */
  seriesOptions: AddOptionsForApp<SeriesFormDefaults> | null;
}) {
  // Several tiles can be adding at once, so these are keyed by tile.
  const [addingKeys, setAddingKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Added tiles, with the new Radarr or Sonarr id (or null).
  const [addedKeys, setAddedKeys] = useState<ReadonlyMap<string, number | null>>(() => new Map());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  // Only one admin panel is open at a time.
  const [picking, setPicking] = useState<PopularTile | null>(null);
  const [movieForm, setMovieForm] = useState<MovieForm | null>(null);
  const [seriesForm, setSeriesForm] = useState<SeriesForm | null>(null);
  // Returning to the page: restores the place when the saved tile is one of these. Runs again when a hidden page is shown.
  const place = usePopularPlace();
  const placeKeys = useMemo(() => new Set(tiles.map((t) => `${section}:${tileKey(t)}`)), [section, tiles]);
  useEffect(() => {
    place?.tilesShown(section, placeKeys);
  }, [place, section, placeKeys]);
  const peekItems = useMemo(() => peekItemsOf(tiles), [tiles]);
  const fieldId = useId();
  // The hover card. Its text comes with each tile, so it asks no route.
  const { gridHandlers, card } = useTilePeek((key) => peekItems.get(key));

  async function runAdd(tile: PopularTile, input: object) {
    const key = tileKey(tile);
    setErrors((previous) => {
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
    setAddingKeys((previous) => new Set(previous).add(key));
    try {
      const response = tile.kind === "movie" ? await addLibraryMovie(input) : await addPopularSeries(input);
      if (response.ok) {
        setAddedKeys((previous) => new Map(previous).set(key, response.id));
        setPicking((current) => (current !== null && tileKey(current) === key ? null : current));
      } else {
        setErrors((previous) => new Map(previous).set(key, response.error));
      }
    } catch {
      setErrors((previous) => new Map(previous).set(key, GENERIC_ERROR));
    } finally {
      // Always clear the tile, so a failed call never leaves its button disabled.
      setAddingKeys((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  }

  function openPanel(tile: PopularTile) {
    setPicking(tile);
    if (tile.kind === "movie") setMovieForm(movieOptions === null ? null : movieFormFor(movieOptions));
    else setSeriesForm(seriesOptions === null ? null : seriesFormFor(seriesOptions));
  }

  function adminAdd(tile: PopularTile) {
    if (tile.kind === "movie") {
      if (movieForm === null || movieForm.profileId === null || movieForm.rootFolderId === null) return;
      void runAdd(tile, {
        tmdbId: tile.tmdbId,
        qualityProfileId: movieForm.profileId,
        rootFolderId: movieForm.rootFolderId,
        monitored: movieForm.monitored,
        searchForMovie: movieForm.searchForMovie,
      });
      return;
    }
    if (seriesForm === null || seriesForm.profileId === null || seriesForm.rootFolderId === null) return;
    void runAdd(tile, {
      tmdbId: tile.tmdbId,
      qualityProfileId: seriesForm.profileId,
      rootFolderId: seriesForm.rootFolderId,
      monitor: seriesForm.monitor,
      seriesType: seriesForm.seriesType,
      seasonFolder: seriesForm.seasonFolder,
      searchForMissingEpisodes: seriesForm.searchForMissingEpisodes,
    });
  }

  return (
    <>
      <ul {...gridHandlers} className={POSTER_GRID_CLASS}>
        {tiles.map((tile) => {
          const key = tileKey(tile);
          const addedId = addedKeys.get(key) ?? null;
          const libraryId = tile.libraryId ?? addedId;
          const inLibrary = tile.inLibrary || addedKeys.has(key);
          const adding = addingKeys.has(key);
          const error = errors.get(key);
          const label = resultLabel(tile);
          const body = (
            <>
              <div data-peek-anchor>
                <PosterTile src={posterSrc(tile)} />
              </div>
              <p className="mt-1.5 truncate text-sm font-medium leading-snug" title={tile.title}>
                {tile.title}
              </p>
              {tile.year !== null && <p className="text-xs text-muted-foreground">{tile.year}</p>}
            </>
          );
          return (
            <li key={key} data-peek-key={key} data-focus-key={`${section}:${key}`} className={POSTER_TILE_CLASS}>
              {/* The poster and title open the title's page: the library page when it is there, else a TMDB preview.
                  The Add button below is not inside the link. */}
              <Link
                href={inLibrary && libraryId !== null ? itemHref(tile.kind, libraryId) : previewHref(tile)}
                draggable={false}
                className="group block rounded-lg hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {body}
              </Link>
              <div className="mt-1.5 space-y-1">
                {inLibrary ? (
                  <Badge variant="secondary">{addedKeys.has(key) ? "Added" : "In library"}</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    aria-label={isAdmin ? `Add ${label}…` : `Add ${label}`}
                    disabled={adding}
                    aria-busy={adding}
                    onClick={() => (isAdmin ? openPanel(tile) : void runAdd(tile, { tmdbId: tile.tmdbId }))}
                  >
                    {adding ? "Adding…" : isAdmin ? "Add…" : "Add"}
                  </Button>
                )}
                {error !== undefined && picking === null && (
                  <p role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {card}

      <Dialog open={picking !== null} onOpenChange={(open) => !open && setPicking(null)}>
        <DialogContent>
          {picking !== null && (
            <>
              <DialogHeader>
                <DialogTitle>Add {resultLabel(picking)}</DialogTitle>
                <DialogDescription>{picking.kind === "movie" ? "Added to Radarr." : "Added to Sonarr."}</DialogDescription>
              </DialogHeader>
              <AdminPanel
                kind={picking.kind}
                appName={picking.kind === "movie" ? "Radarr" : "Sonarr"}
                idBase={`${fieldId}-${tileKey(picking)}`}
                adding={addingKeys.has(tileKey(picking))}
                movieOptions={movieOptions}
                seriesOptions={seriesOptions}
                movieForm={movieForm}
                seriesForm={seriesForm}
                setMovieForm={setMovieForm}
                setSeriesForm={setSeriesForm}
                onCancel={() => setPicking(null)}
                onAdd={() => adminAdd(picking)}
              />
              {errors.get(tileKey(picking)) !== undefined && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.get(tileKey(picking))}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

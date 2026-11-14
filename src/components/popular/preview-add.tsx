"use client";

import Link from "next/link";
import { useId, useState } from "react";
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
import { GENERIC_ERROR, resultLabel } from "@/components/library/add";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The Add button on a Popular preview page. The same flows as a Popular tile: a requester adds at once with the saved
 * defaults, an admin opens the panel with every choice first. The server checks the role and every field on each call.
 * After an add it offers a link to the new library page.
 */
export function PreviewAdd({
  kind,
  tmdbId,
  title,
  year,
  isAdmin,
  movieOptions,
  seriesOptions,
}: {
  kind: "movie" | "series";
  tmdbId: number;
  title: string;
  year: number | null;
  isAdmin: boolean;
  /** Admin only. Null for a requester, or when Radarr's options could not be loaded. */
  movieOptions: AddOptionsForApp<MovieFormDefaults> | null;
  /** Admin only. Null for a requester, or when Sonarr's options could not be loaded. */
  seriesOptions: AddOptionsForApp<SeriesFormDefaults> | null;
}) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<{ id: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [movieForm, setMovieForm] = useState<MovieForm | null>(null);
  const [seriesForm, setSeriesForm] = useState<SeriesForm | null>(null);
  const idBase = useId();
  const label = resultLabel({ title, year });

  async function run(input: object) {
    setError(null);
    setAdding(true);
    try {
      const response = kind === "movie" ? await addLibraryMovie(input) : await addPopularSeries(input);
      if (response.ok) {
        setAdded({ id: response.id });
        setPanelOpen(false);
      } else {
        setError(response.error);
      }
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setAdding(false);
    }
  }

  function openPanel() {
    setPanelOpen(true);
    if (kind === "movie") setMovieForm(movieOptions === null ? null : movieFormFor(movieOptions));
    else setSeriesForm(seriesOptions === null ? null : seriesFormFor(seriesOptions));
  }

  function adminAdd() {
    if (kind === "movie") {
      if (movieForm === null || movieForm.profileId === null || movieForm.rootFolderId === null) return;
      void run({
        tmdbId,
        qualityProfileId: movieForm.profileId,
        rootFolderId: movieForm.rootFolderId,
        monitored: movieForm.monitored,
        searchForMovie: movieForm.searchForMovie,
      });
      return;
    }
    if (seriesForm === null || seriesForm.profileId === null || seriesForm.rootFolderId === null) return;
    void run({
      tmdbId,
      qualityProfileId: seriesForm.profileId,
      rootFolderId: seriesForm.rootFolderId,
      monitor: seriesForm.monitor,
      seriesType: seriesForm.seriesType,
      seasonFolder: seriesForm.seasonFolder,
      searchForMissingEpisodes: seriesForm.searchForMissingEpisodes,
    });
  }

  if (added !== null) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <Badge variant="secondary">Added</Badge>
        {added.id !== null && (
          <Link href={kind === "movie" ? `/movies/${added.id}` : `/tv/${added.id}`} className="font-medium underline">
            Open in library
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        aria-label={isAdmin ? `Add ${label}…` : `Add ${label}`}
        disabled={adding}
        aria-busy={adding}
        onClick={() => (isAdmin ? openPanel() : void run({ tmdbId }))}
      >
        {adding ? "Adding…" : isAdmin ? "Add…" : "Add"}
      </Button>
      {error !== null && !panelOpen && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {label}</DialogTitle>
            <DialogDescription>{kind === "movie" ? "Added to Radarr." : "Added to Sonarr."}</DialogDescription>
          </DialogHeader>
          <AdminPanel
            kind={kind}
            appName={kind === "movie" ? "Radarr" : "Sonarr"}
            idBase={idBase}
            adding={adding}
            movieOptions={movieOptions}
            seriesOptions={seriesOptions}
            movieForm={movieForm}
            seriesForm={seriesForm}
            setMovieForm={setMovieForm}
            setSeriesForm={setSeriesForm}
            onCancel={() => setPanelOpen(false)}
            onAdd={adminAdd}
          />
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

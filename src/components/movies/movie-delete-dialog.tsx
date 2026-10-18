"use client";

import { useId, useState, useTransition } from "react";
import { removeMovies } from "@/app/(app)/movies/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  CONFIRM_WORD,
  canConfirmDelete,
  confirmLabel,
  deleteTitle,
  listedMovies,
  type DeleteMovie,
} from "./movie-delete";
import { MAX_EDIT_MOVIES } from "./movie-edit";

/**
 * Deletes the given movies from Radarr (admin only). `movies` is the snapshot taken when the dialog
 * opened, so the titles shown and the ids sent are the same set. Mounted only while open.
 */
export function MovieDeleteDialog({
  movies,
  onClose,
  onDeleted,
}: {
  movies: (DeleteMovie & { id: number })[];
  onClose: () => void;
  onDeleted: (movieCount: number) => void;
}) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [addExclusion, setAddExclusion] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const filesId = useId();
  const exclusionId = useId();
  const typedId = useId();
  const errorId = useId();

  const ids = movies.map((movie) => movie.id);
  const list = listedMovies(movies);
  const tooMany = ids.length > MAX_EDIT_MOVIES;
  const confirmEnabled = !pending && !tooMany && canConfirmDelete(deleteFiles, typed);

  function confirm() {
    if (!confirmEnabled) return;
    setError(null);
    startTransition(async () => {
      // confirmCount is the snapshot's size. The server refuses the delete if its unique id count differs (it compares counts, not which movies).
      const result = await removeMovies({
        movieIds: ids,
        deleteFiles,
        addImportExclusion: addExclusion,
        confirmCount: ids.length,
      });
      if (result.ok) onDeleted(result.deleted);
      else setError(result.error);
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Don't close while a delete is in flight, so the outcome is never shown to nobody.
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{deleteTitle(movies)}</DialogTitle>
          <DialogDescription>The selected movies are removed from Radarr.</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <ul className="max-h-40 list-disc space-y-0.5 overflow-auto pl-5 text-sm">
            {list.shown.map((label, index) => (
              // Index key: two different movies can share a title and year, so the label alone isn't unique.
              <li key={index}>{label}</li>
            ))}
            {list.more && <li className="list-none pl-0 text-muted-foreground">{list.more}</li>}
          </ul>

          <div className="grid gap-2">
            <label htmlFor={filesId} className="flex items-start gap-2 text-sm">
              <input
                id={filesId}
                type="checkbox"
                checked={deleteFiles}
                onChange={(e) => {
                  setDeleteFiles(e.target.checked);
                  // Unticking clears the typed word, so ticking again needs a fresh confirmation.
                  if (!e.target.checked) setTyped("");
                }}
                disabled={pending}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>Also delete the movie files from disk</span>
            </label>

            {deleteFiles && (
              <div className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm text-destructive">Files are permanently deleted. This can&apos;t be undone.</p>
                <label htmlFor={typedId} className="text-sm">
                  Type <strong>{CONFIRM_WORD}</strong> to confirm
                </label>
                <Input
                  id={typedId}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  disabled={pending}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-describedby={error ? errorId : undefined}
                />
              </div>
            )}
          </div>

          <label htmlFor={exclusionId} className="flex items-start gap-2 text-sm">
            <input
              id={exclusionId}
              type="checkbox"
              checked={addExclusion}
              onChange={(e) => setAddExclusion(e.target.checked)}
              disabled={pending}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>Prevent Radarr from re-adding (add to import exclusions)</span>
          </label>

          {tooMany && (
            <p role="alert" className="text-sm text-destructive">
              Select at most {MAX_EDIT_MOVIES.toLocaleString("en-GB")} movies per delete.
            </p>
          )}
          {error && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!confirmEnabled} aria-busy={pending}>
              {pending ? "Deleting…" : confirmLabel(ids.length, deleteFiles)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

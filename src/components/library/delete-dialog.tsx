"use client";

import { useId, useState, useTransition } from "react";
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
import { CONFIRM_WORD, canConfirmDelete, confirmLabel, deleteTitle, listedItems, type DeleteItem } from "./delete";
import { formatCount } from "./format";
import type { Noun } from "./nouns";

/** What the table sends to its server delete action. `ids` is the snapshot's ids; the server compares `confirmCount` with them. */
export type DeleteRequest = { ids: number[]; deleteFiles: boolean; addExclusion: boolean; confirmCount: number };

/** What a server delete action answers. */
export type DeleteOutcome = { ok: true; deleted: number } | { ok: false; error: string };

/**
 * Deletes the given movies or series from their Arr (admin only). `items` is the snapshot taken when the dialog
 * opened, so the titles shown and the ids sent are the same set. Mounted only while open. `appName` and
 * `exclusionLabel` are the words that differ between Radarr and Sonarr.
 */
export function LibraryDeleteDialog({
  items,
  noun,
  max,
  appName,
  exclusionLabel,
  submit,
  onClose,
  onDeleted,
}: {
  items: (DeleteItem & { id: number })[];
  noun: Noun;
  /** The most rows one delete may remove. The server refuses more than this. */
  max: number;
  /** "Radarr" or "Sonarr", named in the line that says what is removed. */
  appName: string;
  /** The label of the checkbox that adds an import exclusion. */
  exclusionLabel: string;
  submit: (request: DeleteRequest) => Promise<DeleteOutcome>;
  onClose: () => void;
  onDeleted: (count: number) => void;
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

  const ids = items.map((item) => item.id);
  const list = listedItems(items);
  const tooMany = ids.length > max;
  const confirmEnabled = !pending && !tooMany && canConfirmDelete(deleteFiles, typed);

  function confirm() {
    if (!confirmEnabled) return;
    setError(null);
    startTransition(async () => {
      // confirmCount is the snapshot's size. The server refuses the delete if its unique id count differs (it compares counts, not which rows).
      const result = await submit({ ids, deleteFiles, addExclusion, confirmCount: ids.length });
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
          <DialogTitle>{deleteTitle(items, noun)}</DialogTitle>
          <DialogDescription>The selected {noun.many} are removed from {appName}.</DialogDescription>
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
              // Index key: two different rows can share a title and year, so the label alone isn't unique.
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
              <span>Also delete the {noun.one} files from disk</span>
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
            <span>{exclusionLabel}</span>
          </label>

          {tooMany && (
            <p role="alert" className="text-sm text-destructive">
              Select at most {formatCount(max)} {noun.many} per delete.
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
              {pending ? "Deleting…" : confirmLabel(ids.length, deleteFiles, noun)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

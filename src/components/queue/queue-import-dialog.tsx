"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { forceImportQueueItem, loadForceImport } from "@/app/(app)/queue/actions";
import { formatSize } from "@/components/library/format";
import { CELL, HEAD } from "@/components/library/table-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { clashingFiles, type ImportCandidate } from "./queue-import";
import type { QueueRow } from "./queue-rows";

/**
 * The admin's Force import dialog for one Queue row. Mounted only while open, so each open starts fresh. On open it
 * asks the server for the files the app found in the download. The server decides which files start ticked, and the
 * admin can untick or re-tick them. It keeps the row it was opened for, so the dialog stays the same if the row leaves
 * the queue on a refresh. The server says whether the import can still happen.
 */
export function QueueImportDialog({ row, onClose }: { row: QueueRow; onClose: () => void }) {
  const [files, setFiles] = useState<ImportCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // A separate transition for loading, so Cancel still works while the files are being looked for.
  const [, startLoading] = useTransition();
  const errorId = useId();

  const appName = row.app === "radarr" ? "Radarr" : "Sonarr";
  const detail = row.detail !== "" ? ` (${row.detail})` : "";
  const clashing = files === null ? new Set<number>() : clashingFiles(files, ticked);

  useEffect(() => {
    // Cleared when the dialog closes or the row changes, so a late answer is ignored.
    let current = true;
    startLoading(async () => {
      try {
        const result = await loadForceImport({ app: row.app, queueIds: row.queueIds });
        if (!current) return;
        if (result.ok) {
          setFiles(result.files);
          // The files the app would tick on its own start ticked. The admin can change that.
          setTicked(new Set(result.files.filter((file) => file.importable).map((file) => file.id)));
        } else {
          setLoadError(result.error);
        }
      } catch {
        if (current) setLoadError("Something went wrong. Check the queue before trying again.");
      }
    });
    return () => {
      current = false;
    };
  }, [row]);

  function setFileTicked(id: number, checked: boolean) {
    setTicked((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function confirm() {
    if (pending || ticked.size === 0 || clashing.size > 0) return;
    setError(null);
    startTransition(async () => {
      try {
        // The browser sends only the row's queue ids and the ids of the ticked files. The server reads everything else.
        const result = await forceImportQueueItem({
          app: row.app,
          queueIds: row.queueIds,
          fileIds: [...ticked].sort((a, b) => a - b),
        });
        if (result.ok) onClose();
        else setError(result.error);
      } catch {
        // The request itself failed (for example the network dropped), so the import may or may not have started.
        setError("Something went wrong. Check the queue before trying again.");
      }
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Don't close while the import is in flight, so its outcome is never shown to nobody.
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Force import?</DialogTitle>
          <DialogDescription>
            {row.title}
            {detail} from the {appName} queue.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          {files === null && loadError === null && <p className="text-sm text-muted-foreground">Looking for files…</p>}

          {loadError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
          )}

          {files !== null && files.length === 0 && (
            <p className="text-sm text-muted-foreground">No files found in this download.</p>
          )}

          {files !== null && files.length > 0 && (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={HEAD}>
                      <span className="sr-only">Import</span>
                    </TableHead>
                    <TableHead className={HEAD}>File</TableHead>
                    <TableHead className={HEAD}>Matches</TableHead>
                    <TableHead className={HEAD}>Quality</TableHead>
                    <TableHead className={HEAD}>Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((file) => (
                    <TableRow key={file.id}>
                      <TableCell className={CELL}>
                        <input
                          type="checkbox"
                          checked={ticked.has(file.id)}
                          disabled={!file.importable || pending}
                          onChange={(event) => setFileTicked(file.id, event.target.checked)}
                          aria-label={`Import ${file.name}`}
                          className="size-4 accent-primary"
                        />
                      </TableCell>
                      <TableCell className={`${CELL} min-w-48 whitespace-normal`}>
                        <p className="break-all text-sm">{file.name}</p>
                        {clashing.has(file.id) && (
                          <p className="mt-1 text-xs text-destructive">Same movie or episode as another ticked file.</p>
                        )}
                        {file.rejections.length > 0 && (
                          <ul className="mt-1 list-inside list-disc text-xs text-amber-800 dark:text-amber-300">
                            {file.rejections.map((reason) => (
                              <li key={reason} className="break-words">
                                {reason}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell className={`${CELL} min-w-24 whitespace-normal wrap-anywhere`}>
                        {file.match ?? <span className="text-muted-foreground">No match</span>}
                      </TableCell>
                      <TableCell className={`${CELL} whitespace-nowrap`}>{file.quality ?? "—"}</TableCell>
                      <TableCell className={`${CELL} whitespace-nowrap`}>{formatSize(file.sizeBytes ?? 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {clashing.size > 0 && (
            <p role="alert" className="text-sm text-destructive">
              Two ticked files are for the same movie or episode. Untick one.
            </p>
          )}

          {error !== null && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || files === null || ticked.size === 0 || clashing.size > 0}
              aria-busy={pending}
              aria-describedby={error !== null ? errorId : undefined}
            >
              {pending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

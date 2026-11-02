"use client";

import { useId, useState, useTransition } from "react";
import { removeQueueItem } from "@/app/(app)/queue/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { QueueRow } from "./queue-rows";

/**
 * The admin's Remove dialog for one Queue row. Mounted only while open, so each open starts with the default options.
 * It keeps the row it was opened for, so the dialog stays the same even if the row leaves the queue on a refresh.
 * The server says whether the row is still there.
 */
export function QueueRemoveDialog({ row, onClose }: { row: QueueRow; onClose: () => void }) {
  const [removeFromClient, setRemoveFromClient] = useState(true);
  const [blocklist, setBlocklist] = useState(false);
  const [skipRedownload, setSkipRedownload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const clientId = useId();
  const blocklistId = useId();
  const skipId = useId();
  const clientHelpId = useId();
  const blocklistHelpId = useId();
  const skipHelpId = useId();
  const errorId = useId();

  const appName = row.app === "radarr" ? "Radarr" : "Sonarr";
  // Sonarr lists one queue item per episode, so the count of queueIds is the count of episodes.
  const episodeCount = row.queueIds.length;
  const isWholeDownload = row.kind === "episodes" && episodeCount > 1;

  function confirm() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        // The server sends skipRedownload upstream only together with blocklist, and it sends one id, so the browser
        // sends the flags as they are.
        const result = await removeQueueItem({
          app: row.app,
          queueIds: row.queueIds,
          removeFromClient,
          blocklist,
          skipRedownload,
        });
        if (result.ok) onClose();
        else setError(result.error);
      } catch {
        // The request itself failed (for example the network dropped), so the change may or may not have happened.
        setError("Something went wrong. Check the queue before trying again.");
      }
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Don't close while the removal is in flight, so its outcome is never shown to nobody.
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove from queue?</DialogTitle>
          <DialogDescription>
            {row.title}
            {row.detail !== "" && ` (${row.detail})`} is removed from the {appName} queue.
          </DialogDescription>
        </DialogHeader>

        {isWholeDownload && (
          <p className="text-sm">This removes the whole download, all {episodeCount} episodes.</p>
        )}

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          {/* Checked against Radarr and Sonarr source (QueueController.Remove, FailedDownloadService, BlocklistService, RedownloadFailedDownloadService), 2026-11-02. */}
          <div className="grid gap-1">
            <label htmlFor={clientId} className="flex items-start gap-2 text-sm">
              <input
                id={clientId}
                type="checkbox"
                checked={removeFromClient}
                onChange={(event) => setRemoveFromClient(event.target.checked)}
                disabled={pending}
                aria-describedby={clientHelpId}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>Remove from download client</span>
            </label>
            <p id={clientHelpId} className="pl-6 text-xs text-muted-foreground">
              Deletes the download and its files from the download client.
              {!blocklist && ` If unticked, ${appName} stops tracking it and leaves it in the client.`}
            </p>
          </div>

          <div className="grid gap-1">
            <label htmlFor={blocklistId} className="flex items-start gap-2 text-sm">
              <input
                id={blocklistId}
                type="checkbox"
                checked={blocklist}
                onChange={(event) => {
                  setBlocklist(event.target.checked);
                  // Unticking the blocklist clears the replacement option, which only applies with it.
                  if (!event.target.checked) setSkipRedownload(false);
                }}
                disabled={pending}
                aria-describedby={blocklistHelpId}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>Blocklist the release</span>
            </label>
            <p id={blocklistHelpId} className="pl-6 text-xs text-muted-foreground">
              Marks it as failed and adds it to the blocklist so it isn&apos;t grabbed again.
            </p>
          </div>

          {blocklist && (
            <div className="grid gap-1 pl-6">
              <label htmlFor={skipId} className="flex items-start gap-2 text-sm">
                <input
                  id={skipId}
                  type="checkbox"
                  checked={skipRedownload}
                  onChange={(event) => setSkipRedownload(event.target.checked)}
                  disabled={pending}
                  aria-describedby={skipHelpId}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>Don&apos;t search for a replacement</span>
              </label>
              <p id={skipHelpId} className="pl-6 text-xs text-muted-foreground">
                Otherwise {appName} searches again if its Redownload failed setting is on.
              </p>
            </div>
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
              variant="destructive"
              disabled={pending}
              aria-busy={pending}
              aria-describedby={error !== null ? errorId : undefined}
            >
              {pending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

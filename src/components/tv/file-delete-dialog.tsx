"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatSize } from "@/components/library/format";
import { episodeCode } from "@/components/library/release";
import { deleteFiles, previewFileDelete, type ActionResult, type FileDeletePreview } from "@/app/(app)/tv/[id]/actions";

export type FileDeleteTarget = { seasonNumber: number } | { episodeId: number };

type Preview = Extract<FileDeletePreview, { ok: true }>;

const UNREACHABLE = "Couldn't reach MediaHub. Check your connection and try again.";

/**
 * Deletes the downloaded files of one season or episode and keeps the series in Sonarr (admin only). Mounted only
 * while open. On open it asks the server what would go; the file ids it gets back are sent with the delete, and the
 * server checks them again.
 */
export function FileDeleteDialog({
  seriesId,
  target,
  subject,
  onClose,
  onDeleted,
}: {
  seriesId: number;
  target: FileDeleteTarget;
  /** What the admin clicked, e.g. "Season 2" or "S02E03", shown in the description. */
  subject: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unmonitor, setUnmonitor] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a failed delete, so the preview is read again and Delete only ever sends files that still exist.
  const [previewVersion, setPreviewVersion] = useState(0);
  // The version whose preview is on screen. Delete waits until it matches, so it never sends a stale list.
  const [loadedVersion, setLoadedVersion] = useState(-1);
  const [pending, startTransition] = useTransition();
  const unmonitorId = useId();
  const errorId = useId();

  useEffect(() => {
    let cancelled = false;
    previewFileDelete({ seriesId, ...target }).then(
      (result) => {
        if (cancelled) return;
        if (result.ok) {
          setPreview(result);
          setLoadedVersion(previewVersion);
        } else if (previewVersion === 0) {
          setLoadError(result.error);
        }
        // A failed reload after a failed delete keeps the form and its delete error on screen, with Delete disabled.
      },
      () => {
        if (!cancelled && previewVersion === 0) setLoadError(UNREACHABLE);
      },
    );
    return () => {
      cancelled = true;
    };
    // The target object is rebuilt on each render of the caller, so depend on its values.
  }, [previewVersion, seriesId, "seasonNumber" in target ? target.seasonNumber : null, "episodeId" in target ? target.episodeId : null]); // eslint-disable-line react-hooks/exhaustive-deps

  const wantedCount = preview?.episodes.filter((episode) => episode.wanted).length ?? 0;
  // Episodes the click didn't name: a file that holds several episodes goes as a whole.
  const extra =
    preview?.episodes.filter((episode) =>
      "episodeId" in target ? episode.id !== target.episodeId : episode.seasonNumber !== target.seasonNumber,
    ) ?? [];
  const canDelete = preview !== null && loadedVersion === previewVersion && preview.fileCount > 0 && !pending;

  function confirm() {
    if (!preview || !canDelete) return;
    setError(null);
    startTransition(async () => {
      let result: ActionResult;
      try {
        result = await deleteFiles({
          seriesId,
          ...target,
          fileIds: preview.fileIds,
          unmonitor: preview.sonarrUnmonitorsDeleted ? false : unmonitor,
        });
      } catch {
        setError(UNREACHABLE);
        return;
      }
      if (result.ok) {
        onDeleted();
      } else {
        setError(result.error);
        setPreviewVersion((version) => version + 1);
      }
    });
  }

  const title =
    preview === null
      ? "Delete files?"
      : preview.fileCount === 0
        ? "No files to delete"
        : `Delete ${formatCount(preview.fileCount)} ${preview.fileCount === 1 ? "file" : "files"} (${formatSize(preview.totalSize)})?`;

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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>The series stays in Sonarr. Only the downloaded files for {subject} go.</DialogDescription>
        </DialogHeader>

        {loadError !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        ) : preview === null ? (
          <div className="grid gap-2" aria-busy="true">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            {/* On windows at least 800px tall, 12 episodes fit before it scrolls (most seasons are 8–12). */}
            <ul className="max-h-40 list-disc space-y-0.5 overflow-auto pl-5 text-sm [@media(min-height:50rem)]:max-h-72">
              {preview.episodes.map((episode) => (
                <li key={episode.id}>
                  {episodeCode(episode.seasonNumber, episode.episodeNumber)} · {episode.title}
                </li>
              ))}
            </ul>

            {extra.length > 0 && (
              <p className="text-sm">
                {extra.length === 1 ? "This file also holds" : "These files also hold"}{" "}
                {extra.map((episode) => episodeCode(episode.seasonNumber, episode.episodeNumber)).join(", ")}, so{" "}
                {extra.length === 1 ? "its file is" : "their files are"} deleted too.
              </p>
            )}

            <p className="text-sm text-muted-foreground">
              {preview.recycleBinSet
                ? "Files go to Sonarr's Recycle Bin."
                : "Sonarr has no Recycle Bin set, so the files are deleted permanently."}
            </p>

            {preview.sonarrUnmonitorsDeleted ? (
              <p className="text-sm text-muted-foreground">
                Sonarr&apos;s Unmonitor Deleted Episodes setting is on, so Sonarr unmonitors these episodes.
              </p>
            ) : (
              <div className="grid gap-2">
                <label htmlFor={unmonitorId} className="flex items-start gap-2 text-sm">
                  <input
                    id={unmonitorId}
                    type="checkbox"
                    checked={unmonitor}
                    onChange={(e) => setUnmonitor(e.target.checked)}
                    disabled={pending}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>Unmonitor these episodes</span>
                </label>
                {!unmonitor && wantedCount > 0 && (
                  <p className="text-sm text-destructive">
                    {formatCount(wantedCount)} of these episodes {wantedCount === 1 ? "is" : "are"} still monitored, so Sonarr may
                    download {wantedCount === 1 ? "it" : "them"} again.
                  </p>
                )}
              </div>
            )}

            {/* Checked in Sonarr's source: unmonitoring after a delete changes only the episodes' own flags, and a new
                episode starts with its season's flag (RefreshEpisodeService.GetMonitoredStatus). */}
            {"seasonNumber" in target && (
              <p className="text-sm text-muted-foreground">
                The season&apos;s own monitoring stays as it is: that&apos;s how Sonarr works, not a MediaHub choice. When
                Sonarr finds a new episode in a monitored season, it monitors that episode too, so it can still download.
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
              <Button type="submit" variant="destructive" disabled={!canDelete} aria-busy={pending}>
                {pending ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {loadError !== null && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

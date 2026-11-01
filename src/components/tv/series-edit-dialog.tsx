"use client";

import { useId, useState, useTransition } from "react";
import { updateSeries } from "@/app/(app)/tv/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { QualityProfileOption } from "@/server/arr/movies";
import { SELECT_CLASS } from "@/components/movies/movie-edit-dialog";
import type { MonitorChoice } from "@/components/movies/movie-edit";
import { formatCount } from "@/components/movies/movie-format";
import { MAX_EDIT_SERIES, buildEditPayload, editTitle } from "./series-edit";

const KEEP = "keep";

/**
 * Edits the quality profile and/or monitored flag for the given series. Mounted only while open, so each
 * opening starts from "Keep current". `title` is set for a single series (its own title) and omitted for bulk.
 */
export function SeriesEditDialog({
  ids,
  title,
  profiles,
  onClose,
  onSaved,
}: {
  ids: number[];
  title?: string;
  profiles: QualityProfileOption[];
  onClose: () => void;
  onSaved: (seriesCount: number) => void;
}) {
  const [profileValue, setProfileValue] = useState(KEEP);
  const [monitor, setMonitor] = useState<MonitorChoice>("keep");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const profileId = useId();
  const monitorId = useId();
  const errorId = useId();

  const payload = buildEditPayload(ids, profileValue === KEEP ? null : Number(profileValue), monitor);
  // The server refuses more than this, so say so here rather than returning a bare "Invalid edit.".
  const tooMany = ids.length > MAX_EDIT_SERIES;

  function save() {
    if (payload === null) return;
    setError(null);
    startTransition(async () => {
      const result = await updateSeries(payload);
      if (result.ok) onSaved(ids.length);
      else setError(result.error);
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Don't close while a save is in flight, so the outcome is never shown to nobody.
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editTitle(ids.length, title)}</DialogTitle>
          <DialogDescription>Options left at Keep current stay as they are.</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid gap-1.5">
            <label htmlFor={profileId} className="text-sm font-medium">
              Quality profile
            </label>
            <select
              id={profileId}
              value={profileValue}
              onChange={(e) => setProfileValue(e.target.value)}
              disabled={pending}
              aria-describedby={error ? errorId : undefined}
              className={SELECT_CLASS}
            >
              <option value={KEEP}>Keep current</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={String(profile.id)}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={monitorId} className="text-sm font-medium">
              Monitored
            </label>
            <select
              id={monitorId}
              value={monitor}
              onChange={(e) => setMonitor(e.target.value as MonitorChoice)}
              disabled={pending}
              aria-describedby={error ? errorId : undefined}
              className={SELECT_CLASS}
            >
              <option value="keep">Keep current</option>
              <option value="monitored">Monitored</option>
              <option value="unmonitored">Unmonitored</option>
            </select>
          </div>

          {tooMany && (
            <p className="text-sm text-destructive">
              Select at most {formatCount(MAX_EDIT_SERIES)} series per edit.
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
            <Button type="submit" disabled={payload === null || tooMany || pending} aria-busy={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

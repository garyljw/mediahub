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
import type { QualityProfileOption } from "@/server/arr/profiles";
import { editTitle, type MonitorChoice } from "./edit";
import { formatCount } from "./format";
import type { Noun } from "./nouns";
import { SELECT_CLASS } from "./table-parts";

const KEEP = "keep";

/** What a server edit action answers. */
export type SaveOutcome = { ok: true } | { ok: false; error: string };

/**
 * Edits the quality profile and/or monitored flag for the given movies or series. Mounted only while open, so
 * each opening starts from "Keep current". `title` is set for a single row (its own title) and omitted for bulk.
 * The table passes `buildPayload`, which returns the edit to send (or null when nothing would change), and
 * `submit`, which calls its server action.
 */
export function LibraryEditDialog<P>({
  ids,
  title,
  noun,
  max,
  profiles,
  buildPayload,
  submit,
  onClose,
  onSaved,
}: {
  ids: number[];
  title?: string;
  noun: Noun;
  /** The most rows one edit may change. The server refuses more than this. */
  max: number;
  profiles: QualityProfileOption[];
  buildPayload: (profileId: number | null, monitor: MonitorChoice) => P | null;
  submit: (payload: P) => Promise<SaveOutcome>;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const [profileValue, setProfileValue] = useState(KEEP);
  const [monitor, setMonitor] = useState<MonitorChoice>("keep");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const profileId = useId();
  const monitorId = useId();
  const errorId = useId();

  const payload = buildPayload(profileValue === KEEP ? null : Number(profileValue), monitor);
  // The server refuses more than this, so say so here rather than returning a bare "Invalid edit.".
  const tooMany = ids.length > max;

  function save() {
    if (payload === null) return;
    setError(null);
    startTransition(async () => {
      const result = await submit(payload);
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
          <DialogTitle>{editTitle(ids.length, noun, title)}</DialogTitle>
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
              Select at most {formatCount(max)} {noun.many} per edit.
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

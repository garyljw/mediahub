"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useStatusLine } from "@/components/library/use-status-line";
import { SELECT_CLASS } from "@/components/library/table-parts";
import type { QualityProfileOption } from "@/server/arr/profiles";
import { updateSeriesItem } from "@/app/(app)/tv/[id]/actions";
import { SERIES_TYPE_LABELS, SERIES_TYPE_OPTIONS } from "./series-add";
import {
  NEW_ITEM_MONITOR_LABELS,
  NEW_ITEM_MONITOR_OPTIONS,
  buildSeriesEdit,
  isNewItemMonitor,
  isSeriesType,
  type SeriesFormValues,
} from "./series-edit";

const SAVED = "Saved";
const UNREACHABLE = "Couldn't reach MediaHub. Check your connection and try again.";

/**
 * The settings form on a series' page (admin only; the page doesn't render it for anyone else). It starts from the
 * series' current values, and only the fields the admin changes are sent. After a save the page re-renders with the new
 * values, so the form drops its changes and shows the server's values instead.
 */
export function SeriesEditForm({
  seriesId,
  current,
  profiles,
}: {
  seriesId: number;
  current: SeriesFormValues;
  profiles: QualityProfileOption[];
}) {
  // The fields the admin has changed since the page loaded. Any field not in here shows its current value.
  const [changes, setChanges] = useState<Partial<SeriesFormValues>>({});
  const [status, setStatus] = useStatusLine();
  const [saving, startSave] = useTransition();
  const profileFieldId = useId();
  const monitoredFieldId = useId();
  const typeFieldId = useId();
  const seasonFolderFieldId = useId();
  const newItemsFieldId = useId();

  const values: SeriesFormValues = { ...current, ...changes };
  const edit = buildSeriesEdit(seriesId, current, values);
  // A profile that is no longer in the list (or an unknown id) shows as Unknown, and the admin can only move off it.
  const profileKnown = profiles.some((profile) => profile.id === values.qualityProfileId);

  function save() {
    if (edit === null) return;
    setStatus(null);
    startSave(async () => {
      try {
        const result = await updateSeriesItem(edit);
        if (result.ok) {
          setChanges({});
          setStatus(SAVED);
        } else {
          setStatus(result.error);
        }
      } catch {
        setStatus(UNREACHABLE);
      }
    });
  }

  return (
    <form
      className="grid max-w-md gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor={profileFieldId} className="text-sm font-medium">
          Quality profile
        </label>
        <select
          id={profileFieldId}
          value={profileKnown ? String(values.qualityProfileId) : ""}
          onChange={(event) => setChanges((previous) => ({ ...previous, qualityProfileId: Number(event.target.value) }))}
          disabled={saving}
          className={SELECT_CLASS}
        >
          {!profileKnown && (
            <option value="" disabled>
              Unknown
            </option>
          )}
          {profiles.map((profile) => (
            <option key={profile.id} value={String(profile.id)}>
              {profile.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <input
          id={monitoredFieldId}
          type="checkbox"
          checked={values.monitored}
          onChange={(event) => setChanges((previous) => ({ ...previous, monitored: event.target.checked }))}
          disabled={saving}
          className="size-4 accent-primary"
        />
        <label htmlFor={monitoredFieldId} className="text-sm font-medium">
          Monitored
        </label>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={typeFieldId} className="text-sm font-medium">
          Series type
        </label>
        <select
          id={typeFieldId}
          value={values.seriesType ?? ""}
          onChange={(event) => {
            const choice = event.target.value;
            if (isSeriesType(choice)) setChanges((previous) => ({ ...previous, seriesType: choice }));
          }}
          disabled={saving}
          className={SELECT_CLASS}
        >
          {values.seriesType === null && (
            <option value="" disabled>
              Unknown
            </option>
          )}
          {SERIES_TYPE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {SERIES_TYPE_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <input
          id={seasonFolderFieldId}
          type="checkbox"
          checked={values.seasonFolder}
          onChange={(event) => setChanges((previous) => ({ ...previous, seasonFolder: event.target.checked }))}
          disabled={saving}
          className="size-4 accent-primary"
        />
        <label htmlFor={seasonFolderFieldId} className="text-sm font-medium">
          Season folders
        </label>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={newItemsFieldId} className="text-sm font-medium">
          Monitor new seasons
        </label>
        <select
          id={newItemsFieldId}
          value={values.monitorNewItems ?? ""}
          onChange={(event) => {
            const choice = event.target.value;
            if (isNewItemMonitor(choice)) setChanges((previous) => ({ ...previous, monitorNewItems: choice }));
          }}
          disabled={saving}
          className={SELECT_CLASS}
        >
          {values.monitorNewItems === null && (
            <option value="" disabled>
              Unknown
            </option>
          )}
          {NEW_ITEM_MONITOR_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {NEW_ITEM_MONITOR_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={edit === null || saving} aria-busy={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <p
          aria-live={status !== null && status !== SAVED ? "assertive" : "polite"}
          className="min-h-5 text-sm text-muted-foreground"
        >
          {status}
        </p>
      </div>
    </form>
  );
}

"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useStatusLine } from "@/components/library/use-status-line";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { QualityProfileOption } from "@/server/arr/profiles";
import { updateSeriesItem } from "@/app/(app)/tv/[id]/actions";
import {
  MONITOR_HINTS,
  MONITOR_LABELS,
  SERIES_MONITOR_OPTIONS,
  SERIES_TYPE_LABELS,
  SERIES_TYPE_OPTIONS,
  type SeriesMonitor,
} from "./series-add";
import {
  NEW_ITEM_MONITOR_LABELS,
  NEW_ITEM_MONITOR_OPTIONS,
  buildSeriesEdit,
  isNewItemMonitor,
  isSeriesType,
  type SeriesFormValues,
} from "./series-edit";

const SAVED = "Saved";
/** The Episode monitoring choice that sends nothing. Radix Select needs a non-empty value for every item. */
const NO_CHANGE = "no-change";
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
  const presetFieldId = useId();

  const values: SeriesFormValues = { ...current, ...changes };
  const edit = buildSeriesEdit(seriesId, current, values);
  const presetIsNone = values.episodeMonitoring === "none";
  // A profile that is no longer in the list (or an unknown id) shows as Unknown, and the admin can only move off it.
  const profileKnown = profiles.some((profile) => profile.id === values.qualityProfileId);
  // Each box is given its label directly: Radix Select only fills it in after hydration, so it would flash empty.
  const selectedProfileName = profiles.find((profile) => profile.id === values.qualityProfileId)?.name;

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
      className="grid max-w-4xl gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {/* One column on phones; from tablet width the two groups sit side by side. */}
      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        <fieldset className="min-w-0">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monitoring</legend>
          <div className="grid gap-4">
            <div className="flex items-center gap-2">
              <input
                id={monitoredFieldId}
                type="checkbox"
                // "None" also unmonitors the series, so while it is chosen the box shows off and can't be changed.
                // Choosing another preset brings back whatever the box was before.
                checked={presetIsNone ? false : values.monitored}
                onChange={(event) => setChanges((previous) => ({ ...previous, monitored: event.target.checked }))}
                disabled={saving || presetIsNone}
                className="size-4 accent-primary"
              />
              <label htmlFor={monitoredFieldId} className="text-sm font-medium">
                Monitored
              </label>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor={newItemsFieldId} className="text-sm font-medium">
                Monitor new seasons
              </label>
              <Select
                value={values.monitorNewItems ?? ""}
                onValueChange={(choice) => {
                  if (isNewItemMonitor(choice)) setChanges((previous) => ({ ...previous, monitorNewItems: choice }));
                }}
                disabled={saving}
              >
                <SelectTrigger id={newItemsFieldId}>
                  <SelectValue placeholder="Unknown">{values.monitorNewItems === null ? undefined : NEW_ITEM_MONITOR_LABELS[values.monitorNewItems]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {NEW_ITEM_MONITOR_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {NEW_ITEM_MONITOR_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor={presetFieldId} className="text-sm font-medium">
                Episode monitoring
              </label>
              <Select
                value={values.episodeMonitoring ?? NO_CHANGE}
                onValueChange={(choice) => {
                  const preset = SERIES_MONITOR_OPTIONS.find((option) => option === choice) ?? null;
                  setChanges((previous) => ({ ...previous, episodeMonitoring: preset }));
                }}
                disabled={saving}
              >
                <SelectTrigger id={presetFieldId}>
                  <SelectValue>{values.episodeMonitoring === null ? "No change" : MONITOR_LABELS[values.episodeMonitoring]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANGE}>No change</SelectItem>
                  {SERIES_MONITOR_OPTIONS.map((option: SeriesMonitor) => (
                    <SelectItem key={option} value={option}>
                      {MONITOR_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Always shown and two lines tall, so picking a preset doesn't push the form down. */}
              <p className="min-h-10 text-sm text-muted-foreground">
                {values.episodeMonitoring === null
                  ? "Applies a preset once when you save. Sonarr doesn't remember which one was used."
                  : MONITOR_HINTS[values.episodeMonitoring]}
              </p>
            </div>
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files &amp; quality</legend>
          <div className="grid gap-4">
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
              <label htmlFor={profileFieldId} className="text-sm font-medium">
                Quality profile
              </label>
              {/* A profile that isn't in the list shows as the "Unknown" placeholder until the admin picks one. */}
              <Select
                value={profileKnown ? String(values.qualityProfileId) : ""}
                onValueChange={(choice) => setChanges((previous) => ({ ...previous, qualityProfileId: Number(choice) }))}
                disabled={saving}
              >
                <SelectTrigger id={profileFieldId}>
                  <SelectValue placeholder="Unknown">{selectedProfileName}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={String(profile.id)}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor={typeFieldId} className="text-sm font-medium">
                Series type
              </label>
              <Select
                value={values.seriesType ?? ""}
                onValueChange={(choice) => {
                  if (isSeriesType(choice)) setChanges((previous) => ({ ...previous, seriesType: choice }));
                }}
                disabled={saving}
              >
                <SelectTrigger id={typeFieldId}>
                  <SelectValue placeholder="Unknown">{values.seriesType === null ? undefined : SERIES_TYPE_LABELS[values.seriesType]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SERIES_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {SERIES_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </fieldset>
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

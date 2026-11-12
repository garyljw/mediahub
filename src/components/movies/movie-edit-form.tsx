"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useStatusLine } from "@/components/library/use-status-line";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { QualityProfileOption } from "@/server/arr/profiles";
import { updateMovie } from "@/app/(app)/movies/[id]/actions";
import {
  MINIMUM_AVAILABILITY,
  MINIMUM_AVAILABILITY_LABELS,
  buildMovieEdit,
  isMinimumAvailability,
  type MovieFormValues,
} from "./movie-edit";

const SAVED = "Saved";
const UNREACHABLE = "Couldn't reach MediaHub. Check your connection and try again.";

/**
 * The settings form on a movie's page (admin only; the page doesn't render it for anyone else). It starts from the
 * movie's current values, and only the fields the admin changes are sent. After a save the page re-renders with the new
 * values, so the form drops its changes and shows the server's values instead.
 */
export function MovieEditForm({
  movieId,
  current,
  profiles,
}: {
  movieId: number;
  current: MovieFormValues;
  profiles: QualityProfileOption[];
}) {
  // The fields the admin has changed since the page loaded. Any field not in here shows its current value.
  const [changes, setChanges] = useState<Partial<MovieFormValues>>({});
  const [status, setStatus] = useStatusLine();
  const [saving, startSave] = useTransition();
  const profileFieldId = useId();
  const monitoredFieldId = useId();
  const availabilityFieldId = useId();

  const values: MovieFormValues = { ...current, ...changes };
  const edit = buildMovieEdit(movieId, current, values);
  // A profile that is no longer in the list (or an unknown id) shows as Unknown, and the admin can only move off it.
  const profileKnown = profiles.some((profile) => profile.id === values.qualityProfileId);
  // Each box is given its label directly: Radix Select only fills it in after hydration, so it would flash empty.
  const selectedProfileName = profiles.find((profile) => profile.id === values.qualityProfileId)?.name;

  function save() {
    if (edit === null) return;
    setStatus(null);
    startSave(async () => {
      try {
        const result = await updateMovie(edit);
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
              <label htmlFor={availabilityFieldId} className="text-sm font-medium">
                Minimum availability
              </label>
              <Select
                value={values.minimumAvailability ?? ""}
                onValueChange={(choice) => {
                  if (isMinimumAvailability(choice)) setChanges((previous) => ({ ...previous, minimumAvailability: choice }));
                }}
                disabled={saving}
              >
                <SelectTrigger id={availabilityFieldId}>
                  <SelectValue placeholder="Unknown">{values.minimumAvailability === null ? undefined : MINIMUM_AVAILABILITY_LABELS[values.minimumAvailability]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MINIMUM_AVAILABILITY.map((option) => (
                    <SelectItem key={option} value={option}>
                      {MINIMUM_AVAILABILITY_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files &amp; quality</legend>
          <div className="grid gap-4">
            {/* From tablet width, fills the Monitored row's height so Quality profile sits beside Minimum availability. */}
            <div aria-hidden className="hidden h-5 md:block" />

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

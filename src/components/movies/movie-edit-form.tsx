"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useStatusLine } from "@/components/library/use-status-line";
import { SELECT_CLASS } from "@/components/library/table-parts";
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
        <label htmlFor={availabilityFieldId} className="text-sm font-medium">
          Minimum availability
        </label>
        <select
          id={availabilityFieldId}
          value={values.minimumAvailability ?? ""}
          onChange={(event) => {
            const choice = event.target.value;
            if (isMinimumAvailability(choice)) setChanges((previous) => ({ ...previous, minimumAvailability: choice }));
          }}
          disabled={saving}
          className={SELECT_CLASS}
        >
          {values.minimumAvailability === null && (
            <option value="" disabled>
              Unknown
            </option>
          )}
          {MINIMUM_AVAILABILITY.map((option) => (
            <option key={option} value={option}>
              {MINIMUM_AVAILABILITY_LABELS[option]}
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

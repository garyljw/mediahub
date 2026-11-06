"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SELECT_CLASS } from "@/components/library/table-parts";
import {
  MONITOR_LABELS,
  SERIES_MONITOR_OPTIONS,
  SERIES_TYPE_LABELS,
  SERIES_TYPE_OPTIONS,
} from "@/components/tv/series-add";
import type {
  AddItem,
  AddOptionsForApp,
  MovieForm,
  MovieFormDefaults,
  SeriesForm,
  SeriesFormDefaults,
} from "./add-results";

/**
 * The admin's panel under a row: every choice the add takes, starting on the saved defaults. Movies get profile,
 * folder, monitored and search. TV gets profile, folder, monitor, series type, season folders and search.
 */
export function AdminPanel({
  kind,
  appName,
  idBase,
  adding,
  movieOptions,
  seriesOptions,
  movieForm,
  seriesForm,
  setMovieForm,
  setSeriesForm,
  onCancel,
  onAdd,
}: {
  kind: AddItem["kind"];
  appName: "Radarr" | "Sonarr";
  idBase: string;
  adding: boolean;
  movieOptions: AddOptionsForApp<MovieFormDefaults> | null;
  seriesOptions: AddOptionsForApp<SeriesFormDefaults> | null;
  movieForm: MovieForm | null;
  seriesForm: SeriesForm | null;
  setMovieForm: (update: (form: MovieForm | null) => MovieForm | null) => void;
  setSeriesForm: (update: (form: SeriesForm | null) => SeriesForm | null) => void;
  onCancel: () => void;
  onAdd: () => void;
}) {
  const options = kind === "movie" ? movieOptions : seriesOptions;
  const form = kind === "movie" ? movieForm : seriesForm;
  const ready = options !== null && form !== null && form.profileId !== null && form.rootFolderId !== null;

  return (
    <div className="mt-3 space-y-3 rounded-md border p-3">
      {options === null ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load options from {appName}.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            id={`${idBase}-profile`}
            label="Quality profile"
            value={form === null || form.profileId === null ? "" : String(form.profileId)}
            onChange={(value) => {
              const profileId = Number(value);
              if (kind === "movie") setMovieForm((current) => current && { ...current, profileId });
              else setSeriesForm((current) => current && { ...current, profileId });
            }}
            disabled={adding}
          >
            {options.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            id={`${idBase}-folder`}
            label="Root folder"
            value={form === null || form.rootFolderId === null ? "" : String(form.rootFolderId)}
            onChange={(value) => {
              const rootFolderId = Number(value);
              if (kind === "movie") setMovieForm((current) => current && { ...current, rootFolderId });
              else setSeriesForm((current) => current && { ...current, rootFolderId });
            }}
            disabled={adding}
          >
            {options.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.path}
              </option>
            ))}
          </SelectField>

          {kind === "movie" && movieForm !== null && (
            <>
              <CheckField
                id={`${idBase}-monitored`}
                label="Monitored"
                checked={movieForm.monitored}
                onChange={(checked) => setMovieForm((current) => current && { ...current, monitored: checked })}
                disabled={adding}
              />
              <CheckField
                id={`${idBase}-search`}
                label="Search on add"
                checked={movieForm.searchForMovie}
                onChange={(checked) => setMovieForm((current) => current && { ...current, searchForMovie: checked })}
                disabled={adding}
              />
            </>
          )}

          {kind === "series" && seriesForm !== null && (
            <>
              <SelectField
                id={`${idBase}-monitor`}
                label="Monitor"
                value={seriesForm.monitor}
                onChange={(value) => {
                  const monitor = SERIES_MONITOR_OPTIONS.find((choice) => choice === value);
                  if (monitor !== undefined) setSeriesForm((current) => current && { ...current, monitor });
                }}
                disabled={adding}
              >
                {SERIES_MONITOR_OPTIONS.map((choice) => (
                  <option key={choice} value={choice}>
                    {MONITOR_LABELS[choice]}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id={`${idBase}-type`}
                label="Series type"
                value={seriesForm.seriesType}
                onChange={(value) => {
                  const seriesType = SERIES_TYPE_OPTIONS.find((choice) => choice === value);
                  if (seriesType !== undefined) setSeriesForm((current) => current && { ...current, seriesType });
                }}
                disabled={adding}
              >
                {SERIES_TYPE_OPTIONS.map((choice) => (
                  <option key={choice} value={choice}>
                    {SERIES_TYPE_LABELS[choice]}
                  </option>
                ))}
              </SelectField>
              <CheckField
                id={`${idBase}-season-folders`}
                label="Season folders"
                checked={seriesForm.seasonFolder}
                onChange={(checked) => setSeriesForm((current) => current && { ...current, seasonFolder: checked })}
                disabled={adding}
              />
              <CheckField
                id={`${idBase}-search`}
                label="Search on add"
                checked={seriesForm.searchForMissingEpisodes}
                onChange={(checked) => setSeriesForm((current) => current && { ...current, searchForMissingEpisodes: checked })}
                disabled={adding}
              />
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onAdd} disabled={adding || !ready} aria-busy={adding}>
          {adding ? "Adding…" : "Add"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={adding}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={SELECT_CLASS}>
        {children}
      </select>
    </div>
  );
}

function CheckField({
  id,
  label,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-primary"
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

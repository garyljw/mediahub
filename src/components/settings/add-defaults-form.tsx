"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import {
  saveMovieDefaults,
  saveSeriesDefaults,
  type DefaultsResult,
} from "@/app/(app)/settings/add-defaults/actions";
import { Button } from "@/components/ui/button";
import { SELECT_CLASS } from "@/components/library/table-parts";
import { MONITOR_LABELS, SERIES_MONITOR_OPTIONS, type SeriesMonitor } from "@/components/tv/series-add";
import type { ArrApp } from "@/server/settings/connections";

/** A quality profile or root folder as the browser sees it: only the id and the label. */
export type DefaultsProfile = { id: number; name: string };
export type DefaultsFolder = { id: number; path: string };

const NAMES: Record<ArrApp, string> = { radarr: "Radarr", sonarr: "Sonarr" };

/** The stored id when it is still in the list, otherwise the first item, otherwise null. */
function pick(stored: number | null, ids: readonly number[]): number | null {
  if (stored !== null && ids.includes(stored)) return stored;
  return ids[0] ?? null;
}

/**
 * The defaults for one Arr app: quality profile and root folder, plus the monitor option for Sonarr. Saving runs
 * the server action for the app, which checks the ids against the live lists before it stores anything.
 */
export function AddDefaultsForm({
  app,
  profiles,
  folders,
  initial,
}: {
  app: ArrApp;
  profiles: DefaultsProfile[];
  folders: DefaultsFolder[];
  initial: { profileId: number | null; rootFolderId: number | null; monitor?: SeriesMonitor | null };
}) {
  const name = NAMES[app];
  const [profileId, setProfileId] = useState<number | null>(() => pick(initial.profileId, profiles.map((p) => p.id)));
  const [rootFolderId, setRootFolderId] = useState<number | null>(() =>
    pick(initial.rootFolderId, folders.map((f) => f.id)),
  );
  const [monitor, setMonitor] = useState<SeriesMonitor>(initial.monitor ?? "all");
  const [result, setResult] = useState<DefaultsResult | null>(null);
  const [pending, startTransition] = useTransition();

  const profileSelectId = useId();
  const folderSelectId = useId();
  const monitorSelectId = useId();

  const canSave = profileId !== null && rootFolderId !== null;
  // True when a saved profile or folder is missing or no longer in Radarr/Sonarr, so the form shows the first option.
  const notSaved =
    initial.profileId === null ||
    initial.rootFolderId === null ||
    !profiles.some((p) => p.id === initial.profileId) ||
    !folders.some((f) => f.id === initial.rootFolderId);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileId === null || rootFolderId === null) return;
    startTransition(async () => {
      try {
        const outcome =
          app === "radarr"
            ? await saveMovieDefaults({ profileId, rootFolderId })
            : await saveSeriesDefaults({ profileId, rootFolderId, monitor });
        setResult(outcome);
      } catch {
        setResult({ ok: false, message: `Couldn't save the ${name} defaults.` });
      }
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={profileSelectId} className="text-sm font-medium">
            Quality profile
          </label>
          <select
            id={profileSelectId}
            value={profileId === null ? "" : String(profileId)}
            onChange={(event) => {
              setProfileId(Number(event.target.value));
              setResult(null);
            }}
            className={SELECT_CLASS}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={folderSelectId} className="text-sm font-medium">
            Root folder
          </label>
          <select
            id={folderSelectId}
            value={rootFolderId === null ? "" : String(rootFolderId)}
            onChange={(event) => {
              setRootFolderId(Number(event.target.value));
              setResult(null);
            }}
            className={SELECT_CLASS}
          >
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.path}
              </option>
            ))}
          </select>
        </div>
        {app === "sonarr" && (
          <div className="grid gap-1.5">
            <label htmlFor={monitorSelectId} className="text-sm font-medium">
              Monitor
            </label>
            <select
              id={monitorSelectId}
              value={monitor}
              onChange={(event) => {
                const choice = SERIES_MONITOR_OPTIONS.find((option) => option === event.target.value);
                if (choice !== undefined) setMonitor(choice);
                setResult(null);
              }}
              className={SELECT_CLASS}
            >
              {SERIES_MONITOR_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {MONITOR_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {notSaved && result === null && (
        <p className="text-sm text-muted-foreground">No saved default yet, so the first options are shown. Save to keep them.</p>
      )}
      <p className="text-xs text-muted-foreground">
        Requesters always add with these. Admins start with this profile and can pick another when adding.
      </p>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || !canSave}>
          Save {name} defaults
        </Button>
      </div>
      {result?.ok === true && (
        <p role="status" className="text-sm">
          Saved.
        </p>
      )}
      {result?.ok === false && (
        <p role="alert" className="text-sm text-destructive">
          {result.message}
        </p>
      )}
    </form>
  );
}

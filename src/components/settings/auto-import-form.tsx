"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { saveAutoImportSetting, type AutoImportResult } from "@/app/(app)/settings/connections/auto-import-actions";
import { Button } from "@/components/ui/button";

/** The Settings switch that lets MediaHub import downloads Radarr or Sonarr blocked as matched by ID. */
export function AutoImportForm({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [result, setResult] = useState<AutoImportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const checkboxId = useId();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        setResult(await saveAutoImportSetting({ on }));
      } catch {
        setResult({ ok: false, message: "Couldn't save the setting." });
      }
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="flex items-start gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          checked={on}
          onChange={(event) => {
            setOn(event.target.checked);
            setResult(null);
          }}
          className="mt-1 h-4 w-4 rounded border"
        />
        <div className="grid gap-1">
          <label htmlFor={checkboxId} className="text-sm font-medium">
            Auto-import downloads matched by ID
          </label>
          <p className="text-sm text-muted-foreground">
            When Radarr or Sonarr grabbed a download for a movie or series but won&apos;t import it because its name didn&apos;t
            match, MediaHub imports it anyway. Only files Radarr or Sonarr match to that movie or series with no other problem
            are imported.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          Save import setting
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

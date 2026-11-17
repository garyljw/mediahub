"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import {
  savePopularIncludeSettings,
  type PopularServicesResult,
} from "@/app/(app)/settings/popular/actions";
import { Button } from "@/components/ui/button";
import {
  POPULAR_INCLUDE_KEYS,
  POPULAR_INCLUDE_LABELS,
  type PopularInclude,
} from "./popular-includes";

/** Which of the categories Popular normally leaves out to show. Nothing is stored until Save. */
export function PopularIncludesForm({ initial }: { initial: PopularInclude[] }) {
  const idPrefix = useId();
  const [include, setInclude] = useState<PopularInclude[]>(initial);
  const [result, setResult] = useState<PopularServicesResult | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(key: PopularInclude, checked: boolean) {
    setInclude((current) => (checked ? [...current.filter((k) => k !== key), key] : current.filter((k) => k !== key)));
    setResult(null);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        setResult(await savePopularIncludeSettings({ include }));
      } catch {
        setResult({ ok: false, message: "Couldn't save the Popular settings." });
      }
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <section aria-labelledby={`${idPrefix}-heading`} className="space-y-2">
        <h2 id={`${idPrefix}-heading`} className="text-sm font-medium">
          Also show
        </h2>
        <p className="text-sm text-muted-foreground">Popular leaves these out. Tick any you want included.</p>
        <div className="space-y-2">
          {POPULAR_INCLUDE_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-3">
              <input
                id={`${idPrefix}-${key}`}
                type="checkbox"
                checked={include.includes(key)}
                onChange={(event) => toggle(key, event.target.checked)}
                className="h-4 w-4 rounded border"
              />
              <label htmlFor={`${idPrefix}-${key}`} className="text-sm">
                {POPULAR_INCLUDE_LABELS[key]}
              </label>
            </div>
          ))}
        </div>
      </section>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          Save
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

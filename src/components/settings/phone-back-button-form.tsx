"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { savePhoneBackButtonSetting, type PhoneBackButtonResult } from "@/app/(app)/settings/display/actions";
import { Button } from "@/components/ui/button";

/** The Settings switch that adds a Back button to the phone bottom bar. */
export function PhoneBackButtonForm({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [result, setResult] = useState<PhoneBackButtonResult | null>(null);
  const [pending, startTransition] = useTransition();
  const checkboxId = useId();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        setResult(await savePhoneBackButtonSetting({ on }));
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
            Back button on phones
          </label>
          <p className="text-sm text-muted-foreground">
            Adds a Back button to the bottom bar on phones and other narrow screens. It goes back to the previous page in
            MediaHub, which helps when MediaHub is opened from the home screen, where there&apos;s no browser Back button.
            Applies to everyone.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          Save display setting
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

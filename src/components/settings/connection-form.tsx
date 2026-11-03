"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  saveConnectionSettings,
  testConnection,
  type ConnectionResult,
} from "@/app/(app)/settings/connections/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ArrApp } from "@/server/settings/connections";

const NAMES: Record<ArrApp, string> = { radarr: "Radarr", sonarr: "Sonarr" };

/**
 * Address and API key for one Arr app. The key field always starts empty: a stored key is never sent to the
 * browser, so `hasKey` only changes the placeholder. A blank key on Test or Save keeps the stored key, when the
 * server accepts that (see resolveApiKey).
 */
export function ConnectionForm({ app, url, hasKey }: { app: ArrApp; url: string | null; hasKey: boolean }) {
  const name = NAMES[app];
  const [address, setAddress] = useState(url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function test() {
    startTransition(async () => {
      setResult(await testConnection({ app, url: address, apiKey }));
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const outcome = await saveConnectionSettings({ app, url: address, apiKey });
      setResult(outcome);
      if (outcome.ok) setApiKey("");
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={`${app}-address`} className="text-sm font-medium">
          Address
        </label>
        <Input
          id={`${app}-address`}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            setResult(null);
          }}
          placeholder="http://192.168.1.10:7878"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${app}-key`} className="text-sm font-medium">
          API key
        </label>
        <Input
          id={`${app}-key`}
          type="password"
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            setResult(null);
          }}
          placeholder={hasKey ? "Saved. Leave blank to keep it." : "Paste the API key"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">{name}: Settings → General → API Key</p>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={test} disabled={pending}>
          Test
        </Button>
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      </div>
      {result?.ok === true && (
        <p role="status" className="text-sm">
          Connected to {result.appName} {result.version}.
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

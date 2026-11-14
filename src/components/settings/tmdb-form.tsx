"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  removeTmdbSettings,
  saveTmdbSettings,
  type TmdbResult,
} from "@/app/(app)/settings/connections/tmdb-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TMDB_LANGUAGES, type TmdbLanguage } from "./tmdb-languages";

/**
 * Read Access Token and country for TMDB. The token field always starts empty: a stored token is never sent to
 * the browser, so `hasToken` only changes the placeholder. A blank token on Save keeps the stored one.
 */
export function TmdbForm({
  hasToken,
  region,
  language,
  regions,
}: {
  hasToken: boolean;
  region: string;
  language: TmdbLanguage;
  regions: { code: string; name: string }[];
}) {
  const [token, setToken] = useState("");
  const [country, setCountry] = useState(region);
  const [originalLanguage, setOriginalLanguage] = useState<TmdbLanguage>(language);
  const [result, setResult] = useState<TmdbResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Before a token is stored the list isn't available, so only the current value is offered.
  const options = regions.some((r) => r.code === country) ? regions : [{ code: country, name: country }, ...regions];

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const outcome = await saveTmdbSettings({ token, region: country, language: originalLanguage });
      setResult(outcome);
      if (outcome.ok) setToken("");
    });
  }

  function remove() {
    startTransition(async () => {
      const outcome = await removeTmdbSettings();
      setResult(outcome);
      if (outcome.ok) setToken("");
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Optional. Powers the Popular page. Get a free API Read Access Token from themoviedb.org → Settings → API (use
        the long Read Access Token, not the short API key).
      </p>
      <div className="space-y-1.5">
        <label htmlFor="tmdb-token" className="text-sm font-medium">
          Read Access Token
        </label>
        <Input
          id="tmdb-token"
          type="password"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            setResult(null);
          }}
          placeholder={hasToken ? "Saved. Leave blank to keep it." : "Paste the Read Access Token"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="tmdb-region" className="text-sm font-medium">
          Country
        </label>
        <select
          id="tmdb-region"
          value={country}
          onChange={(event) => {
            setCountry(event.target.value);
            setResult(null);
          }}
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
        >
          {options.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
        {!hasToken && (
          <p className="text-xs text-muted-foreground">Save a token to choose from the full list of countries.</p>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="tmdb-language" className="text-sm font-medium">
          Original language
        </label>
        <select
          id="tmdb-language"
          value={originalLanguage}
          onChange={(event) => {
            setOriginalLanguage(event.target.value as TmdbLanguage);
            setResult(null);
          }}
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
        >
          {TMDB_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">For Upcoming TV and On this week.</p>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        {hasToken && (
          <Button type="button" variant="outline" onClick={remove} disabled={pending}>
            Remove
          </Button>
        )}
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

"use client";

import { useEffect, useState } from "react";

// The only site the start route may send the browser to. Anything else is treated as a failure.
const PLEX_AUTH_ORIGIN = "https://app.plex.tv";

function isPlexAuthUrl(value: string): boolean {
  try {
    return new URL(value).origin === PLEX_AUTH_ORIGIN;
  } catch {
    return false;
  }
}

export function PlexSignInButton({ label = "Sign in with Plex" }: { label?: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // Coming back from plex.tv with Back can restore this page from the browser's cache, still pending.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function start() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/auth/plex/start", {
        method: "POST",
        credentials: "same-origin",
        // Better Auth only accepts JSON bodies, and Next passes even an empty POST on with a body, so send {}.
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body: unknown = response.ok ? await response.json() : null;
      const url = typeof body === "object" && body !== null && "url" in body && typeof body.url === "string" ? body.url : "";
      if (!isPlexAuthUrl(url)) throw new Error("unexpected sign-in address");
      // Stays pending: the browser is leaving for plex.tv.
      window.location.assign(url);
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Opening Plex..." : label}
      </button>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Could not start Plex sign-in. Try again.
        </p>
      )}
    </div>
  );
}

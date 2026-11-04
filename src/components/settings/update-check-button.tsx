"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkForUpdatesNow } from "@/app/(app)/settings/updates/actions";
import { Button } from "@/components/ui/button";

const POLL_MS = 15_000;

/**
 * "Check for updates now". While a check is queued or running, the page refreshes every 15 seconds so the
 * server-side status shows up without a manual reload.
 */
export function UpdateCheckButton({ queued, checking }: { queued: boolean; checking: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const polling = queued || checking;

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [polling, router]);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await checkForUpdatesNow();
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={onClick} disabled={pending || queued}>
        Check for updates now
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

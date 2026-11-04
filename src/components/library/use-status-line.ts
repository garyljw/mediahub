import { useEffect, useState } from "react";

// How long a status line stays before it clears itself. Matches the other status lines.
const STATUS_MS = 4000;

/**
 * A detail page's status line under its action buttons. It clears itself after a few seconds, like the other status lines.
 * Setting a new value restarts the timer, and a selection change elsewhere doesn't apply here.
 */
export function useStatusLine() {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (status === null) return;
    const timer = window.setTimeout(() => setStatus(null), STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  return [status, setStatus] as const;
}

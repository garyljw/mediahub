"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type AutoRefresh, createAutoRefresh, QUEUE_REFRESH_MS } from "./auto-refresh";

/**
 * Refreshes the Queue page's server data every few seconds while the tab is visible. Each refresh runs in a transition,
 * and the next one is scheduled only once the transition has finished, so refreshes never overlap.
 */
export function useQueueAutoRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const refresherRef = useRef<AutoRefresh | null>(null);

  useEffect(() => {
    const refresher = createAutoRefresh({
      refresh: () => startTransition(() => router.refresh()),
      isHidden: () => document.visibilityState === "hidden",
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      intervalMs: QUEUE_REFRESH_MS,
    });
    refresherRef.current = refresher;
    const onVisibility = () => refresher.onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibility);
    refresher.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      refresher.stop();
      refresherRef.current = null;
    };
  }, [router, startTransition]);

  // The transition ends once the refreshed page has rendered. Only then does the loop schedule its next refresh.
  useEffect(() => {
    if (!isPending) refresherRef.current?.onRefreshDone();
  }, [isPending]);
}

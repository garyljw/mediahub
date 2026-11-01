"use client";

import { useEffect, useState } from "react";
import type { QueueActivity } from "@/server/arr/activity";
import { createActivityPoller } from "./activity-poller";
import { ACTIVITY_POLL_MS, ACTIVITY_TIMEOUT_MS, activityById } from "./activity";

export type ActivityResult = { byId: Map<number, QueueActivity>; failed: boolean };

/**
 * Live queue state per row id, polled from one activity route (Radarr for Movies, Sonarr for TV). The polling
 * rules live in activity-poller.ts; this hook only wires the browser's fetch, timers and tab visibility to it.
 */
export function useActivity(url: string): ActivityResult {
  // Empty on the server and on the first browser render, so the column never mismatches during hydration.
  const [state, setState] = useState<ActivityResult>({ byId: new Map(), failed: false });

  useEffect(() => {
    const poller = createActivityPoller({
      fetchActivity: (signal) => fetch(url, { cache: "no-store", signal }),
      isHidden: () => document.visibilityState === "hidden",
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      onChange: ({ items, failed }) => setState({ byId: activityById(items), failed }),
      pollMs: ACTIVITY_POLL_MS,
      timeoutMs: ACTIVITY_TIMEOUT_MS,
    });
    const onVisibilityChange = () => poller.onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    poller.start();
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [url]);

  return state;
}

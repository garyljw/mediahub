"use client";

import { useEffect, useState } from "react";
import type { MovieActivity } from "@/server/arr/activity";
import { createActivityPoller } from "./activity-poller";
import { ACTIVITY_POLL_MS, ACTIVITY_TIMEOUT_MS, activityByMovie } from "./movie-activity";

const ACTIVITY_URL = "/api/movies/activity";

export type MovieActivityState = { byMovie: Map<number, MovieActivity>; failed: boolean };

/**
 * Live Radarr queue state per movie. The polling rules live in activity-poller.ts; this hook only wires the
 * browser's fetch, timers and tab visibility to it.
 */
export function useMovieActivity(): MovieActivityState {
  // Empty on the server and on the first browser render, so the column never mismatches during hydration.
  const [state, setState] = useState<MovieActivityState>({ byMovie: new Map(), failed: false });

  useEffect(() => {
    const poller = createActivityPoller({
      fetchActivity: (signal) => fetch(ACTIVITY_URL, { cache: "no-store", signal }),
      isHidden: () => document.visibilityState === "hidden",
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      onChange: ({ items, failed }) => setState({ byMovie: activityByMovie(items), failed }),
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
  }, []);

  return state;
}

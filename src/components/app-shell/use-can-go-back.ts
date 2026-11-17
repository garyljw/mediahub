"use client";

import { useSyncExternalStore } from "react";

// The browser's Navigation API knows whether this tab has an earlier entry from this site, and counts replaces,
// jumps of several entries and reloads correctly. Entries from other sites aren't included, so Back can't leave
// MediaHub. TypeScript 5.9's DOM types don't include it yet, so only the parts used here are declared.
type NavigationLike = Pick<EventTarget, "addEventListener" | "removeEventListener"> & { canGoBack: boolean };

function navigationApi(): NavigationLike | undefined {
  return (window as Window & { navigation?: NavigationLike }).navigation;
}

function subscribe(onChange: () => void): () => void {
  const navigation = navigationApi();
  navigation?.addEventListener("currententrychange", onChange);
  return () => navigation?.removeEventListener("currententrychange", onChange);
}

// A browser without the Navigation API can't say, so Back stays on there and acts like the browser's own Back.
const getSnapshot = () => navigationApi()?.canGoBack ?? true;

// The server can't know the tab's history, so the first render says no and the browser corrects it straight away.
const getServerSnapshot = () => false;

/** True when the tab has an earlier MediaHub page to go back to. */
export function useCanGoBack(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// The two Focus lists. Client-safe, and the one source for the kinds: the server (src/server/focus/focus.ts) and the
// Zod enums import FOCUS_KINDS from here.
export const FOCUS_KINDS = ["movie", "series"] as const;
export type FocusKind = (typeof FOCUS_KINDS)[number];

export const FOCUS_NAME: Record<FocusKind, string> = { movie: "Movie Focus", series: "TV Focus" };

/** The Arr app each list draws from. */
export const FOCUS_APP: Record<FocusKind, "Radarr" | "Sonarr"> = { movie: "Radarr", series: "Sonarr" };

export const SAVE_FAILED = "Couldn't save. Try again.";

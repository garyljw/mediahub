// Pure edit logic for the movie page's settings form. Must not import from src/server at runtime (type imports are fine).
// The option list lives here so the server's Zod schema and the form share one source.
import type { components as RadarrComponents } from "@/server/arr/generated/radarr";
import type { MovieEdit } from "@/server/arr/movies";

type MovieStatusType = RadarrComponents["schemas"]["MovieStatusType"];

/** The minimum availability values the movie form offers. Each one is a Radarr MovieStatusType (checked at compile time). */
export const MINIMUM_AVAILABILITY = ["announced", "inCinemas", "released"] as const satisfies readonly MovieStatusType[];
export type MinimumAvailability = (typeof MINIMUM_AVAILABILITY)[number];

export const MINIMUM_AVAILABILITY_LABELS: Record<MinimumAvailability, string> = {
  announced: "Announced",
  inCinemas: "In cinemas",
  released: "Released",
};

/** True for a value the form offers. The generated type also allows statuses the form leaves out, such as "tba" and "deleted". */
export function isMinimumAvailability(value: unknown): value is MinimumAvailability {
  return (MINIMUM_AVAILABILITY as readonly unknown[]).includes(value);
}

/** The values the form edits. A null minimum availability means Radarr sent a value the form doesn't offer. */
export type MovieFormValues = {
  qualityProfileId: number;
  monitored: boolean;
  minimumAvailability: MinimumAvailability | null;
};

/**
 * The edit to send: only the fields where `next` differs from `current`, plus the movie id. Null when nothing
 * differs. The form can't choose "no value", so a null minimum availability is never sent back.
 */
export function buildMovieEdit(movieId: number, current: MovieFormValues, next: MovieFormValues): MovieEdit | null {
  const edit: MovieEdit = { movieId };
  let changed = false;
  if (next.qualityProfileId !== current.qualityProfileId) {
    edit.qualityProfileId = next.qualityProfileId;
    changed = true;
  }
  if (next.monitored !== current.monitored) {
    edit.monitored = next.monitored;
    changed = true;
  }
  if (next.minimumAvailability !== null && next.minimumAvailability !== current.minimumAvailability) {
    edit.minimumAvailability = next.minimumAvailability;
    changed = true;
  }
  return changed ? edit : null;
}

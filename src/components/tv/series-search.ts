// Pure "search now" logic for the TV table. Must not import from src/server at runtime.
import { SERIES, countNoun } from "@/components/library/nouns";

/**
 * Most series one search request may cover (src/app/(app)/tv/actions.ts uses this same value).
 * Each series is its own Sonarr command, and it searches every monitored episode on every indexer,
 * so this is far lower than the Movies limit of 100.
 */
export const MAX_SEARCH_SERIES = 25;

/** The brief status line after Sonarr accepts a search. Sonarr only queues the search, so it is "started", not finished. */
export function searchStartedMessage(seriesCount: number): string {
  return `Started a search for ${countNoun(seriesCount, SERIES)}`;
}

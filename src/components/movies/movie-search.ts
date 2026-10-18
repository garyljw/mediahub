// Pure "search now" logic for the Movies table. Must not import from src/server at runtime.

/**
 * Most movies one search request may cover (src/app/(app)/movies/actions.ts uses this same value).
 * Each movie makes Radarr query every indexer, so this is far lower than the edit limit.
 */
export const MAX_SEARCH_MOVIES = 100;

/** The brief status line after Radarr accepts a search. Radarr only queues the search, so it is "started", not finished. */
export function searchStartedMessage(movieCount: number): string {
  return `Started a search for ${movieCount} ${movieCount === 1 ? "movie" : "movies"}`;
}

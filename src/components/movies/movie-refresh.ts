// Pure "refresh & scan" logic for the Movies table. Must not import from src/server at runtime.
import { MAX_BULK_MOVIES } from "./movie-bulk";

/**
 * Most movies one refresh request may cover (src/app/(app)/movies/actions.ts uses this same value).
 * Refresh doesn't touch indexers. Radarr runs it as one queued job and its own "Update All" refreshes the
 * whole library, so it shares the bulk limit.
 */
export const MAX_REFRESH_MOVIES = MAX_BULK_MOVIES;

/**
 * The brief status line after Radarr accepts a refresh. Radarr only queues the command, so it is "started", not
 * finished, and the table only changes once the user reloads.
 */
export function refreshStartedMessage(movieCount: number): string {
  return `Started a refresh and scan for ${movieCount} ${movieCount === 1 ? "movie" : "movies"}. Reload in a minute to see changes.`;
}

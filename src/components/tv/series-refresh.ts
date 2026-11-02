// Pure "refresh & scan" logic for the TV table. Must not import from src/server at runtime.
import { SERIES, countNoun } from "@/components/library/nouns";
import { MAX_BULK_SERIES } from "./series-bulk";

/**
 * Most series one refresh request may cover (src/app/(app)/tv/actions.ts uses this same value).
 * Refresh doesn't touch indexers. Sonarr runs it as one queued job, so it shares the bulk limit.
 */
export const MAX_REFRESH_SERIES = MAX_BULK_SERIES;

/**
 * The brief status line after Sonarr accepts a refresh. Sonarr only queues the command, so it is "started", not
 * finished, and the table only changes once the user reloads.
 */
export function refreshStartedMessage(seriesCount: number): string {
  return `Started a refresh and scan for ${countNoun(seriesCount, SERIES)}. Reload in a minute to see changes.`;
}

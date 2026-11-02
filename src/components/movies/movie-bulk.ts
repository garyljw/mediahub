// Pure limits for the bulk actions on the Movies table. Must not import from src/server at runtime.

/**
 * Most movies one bulk delete or refresh may cover (src/app/(app)/movies/actions.ts uses this same value). The
 * movie page's delete and refresh use it too.
 */
export const MAX_BULK_MOVIES = 2000;

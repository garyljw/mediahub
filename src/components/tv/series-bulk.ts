// Pure limits for the bulk actions on the TV table. Must not import from src/server at runtime.

/**
 * Most series one bulk delete or refresh may cover (src/app/(app)/tv/actions.ts uses this same value). The series
 * page's delete and refresh use it too.
 */
export const MAX_BULK_SERIES = 2000;

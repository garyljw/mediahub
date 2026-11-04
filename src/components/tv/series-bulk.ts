// Pure id limit for the series actions. Must not import from src/server at runtime.

/** Most series one delete or refresh call may cover. The series page sends one. */
export const MAX_BULK_SERIES = 2000;

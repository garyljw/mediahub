// Pure id limit for the movie actions. Must not import from src/server at runtime.

/** Most movies one delete or refresh call may cover. The movie page sends one. */
export const MAX_BULK_MOVIES = 2000;

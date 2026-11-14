import "server-only";

// The error every TMDB request throws. Messages name the step and the kind or status only. They never contain a
// host, URL, token or response body, so they are safe to log.

export type TmdbFailureKind = "timeout" | "network" | "invalid" | "http";

export class TmdbRequestError extends Error {
  constructor(
    message: string,
    readonly kind: TmdbFailureKind,
    /** Set only when TMDB answered with a non-OK status. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "TmdbRequestError";
  }
}

/** The text a user sees when a TMDB request failed. */
export function tmdbFailureText(error: TmdbRequestError): string {
  if (error.kind === "http" && error.status === 401) return "TMDB didn't accept that token.";
  if (error.kind === "http" && error.status === 429) return "TMDB is busy, try again shortly.";
  if (error.kind === "timeout") return "TMDB took too long to answer. Try again.";
  if (error.kind === "invalid") return "TMDB sent a reply MediaHub couldn't read.";
  if (error.kind === "network") return "Couldn't reach TMDB. Try again.";
  return "TMDB couldn't answer. Try again.";
}

/**
 * The text for a failed TMDB request on the Popular pages. A refused saved token is worded for the reader: an admin can
 * fix it, a requester is told to ask. Everything else is tmdbFailureText. (The settings form, which checks a token the
 * admin just typed, uses tmdbFailureText: "TMDB didn't accept that token.")
 */
export function tmdbFailureFor(error: TmdbRequestError, isAdmin: boolean): string {
  if (error.kind === "http" && error.status === 401) {
    return isAdmin
      ? "TMDB no longer accepts the saved token."
      : "Popular can't reach TMDB right now. Ask the admin to check the TMDB token.";
  }
  return tmdbFailureText(error);
}

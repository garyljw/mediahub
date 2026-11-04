import "server-only";

// The error every Plex request throws, for both plex.tv (client.ts) and a Plex Media Server (server.ts).
// Messages name the step and the kind or status only. They never contain a token, URL or response body,
// so they are safe to log.

export type PlexFailureKind = "timeout" | "network" | "invalid" | "http";

export class PlexRequestError extends Error {
  constructor(
    message: string,
    readonly kind: PlexFailureKind,
    /** Set only when the server answered with a non-OK status. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "PlexRequestError";
  }
}

const FAILURE_TEXT: Record<Exclude<PlexFailureKind, "http">, string> = {
  timeout: "timed out",
  network: "network error",
  invalid: "invalid response",
};

/** The kind of failure behind a thrown value. The underlying error is never passed on: it may contain the URL. */
export function failureKind(error: unknown): Exclude<PlexFailureKind, "http"> {
  // fetch with AbortSignal.timeout() rejects with a TimeoutError DOMException. (The pinned https path in server.ts
  // detects its own timeout from the signal instead, so an AbortError from elsewhere is not mistaken for one.)
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (error instanceof SyntaxError) return "invalid";
  return "network";
}

/** A PlexRequestError for a request that failed before any HTTP status was read. */
export function transportError(step: string, error: unknown): PlexRequestError {
  return kindError(step, failureKind(error));
}

/** A PlexRequestError with a known kind. The message is the step and the kind only. */
export function kindError(step: string, kind: Exclude<PlexFailureKind, "http">): PlexRequestError {
  return new PlexRequestError(`${step} request failed: ${FAILURE_TEXT[kind]}`, kind);
}

import "server-only";

/**
 * A failed Radarr/Sonarr request. Messages never contain the host, URL, key or response
 * body, so they are safe to log. Config errors from env() are not wrapped in this.
 */
export type ArrFailureKind = "timeout" | "invalid" | "network" | "http";

export class ArrRequestError extends Error {
  constructor(
    message: string,
    /** "timeout" matters to callers: the upstream may still have done the work. */
    readonly kind: ArrFailureKind = "http",
    /** The HTTP status, set only when Radarr/Sonarr answered with a non-OK status. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "ArrRequestError";
  }
}

/** Long enough for a slow NAS, short enough that a stalled Radarr/Sonarr doesn't hang a page. */
export const ARR_TIMEOUT_MS = 15_000;

/**
 * Runs one typed client call and returns its data once the response is OK.
 * `label` names the request in errors, e.g. "Radarr movie". Build the client outside `get`
 * so env() config errors surface as-is instead of as a network error.
 */
export async function arrRequest<T>(
  label: string,
  get: (signal: AbortSignal) => Promise<{ data?: T; response: Response }>,
  { timeoutMs = ARR_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<T | undefined> {
  let result: Awaited<ReturnType<typeof get>>;
  try {
    result = await get(AbortSignal.timeout(timeoutMs));
  } catch (error) {
    // Name the kind of failure, but never surface the underlying error: it may contain the host.
    const kind = failureKind(error);
    throw new ArrRequestError(`${label} request failed: ${FAILURE_TEXT[kind]}`, kind);
  }
  if (!result.response.ok) {
    throw new ArrRequestError(`${label} request failed: HTTP ${result.response.status}`, "http", result.response.status);
  }
  return result.data;
}

const FAILURE_TEXT: Record<Exclude<ArrFailureKind, "http">, string> = {
  timeout: "timed out",
  invalid: "invalid response",
  network: "network error",
};

function failureKind(error: unknown): Exclude<ArrFailureKind, "http"> {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  // openapi-fetch parses OK responses as JSON, so a non-JSON body (e.g. a login page) lands here.
  if (error instanceof SyntaxError) return "invalid";
  return "network";
}

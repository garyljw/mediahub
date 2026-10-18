import "server-only";

/**
 * A failed Radarr/Sonarr request. Messages never contain the host, URL, key or response
 * body, so they are safe to log. Config errors from env() are not wrapped in this.
 */
export class ArrRequestError extends Error {
  constructor(message: string) {
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
): Promise<T | undefined> {
  let result: Awaited<ReturnType<typeof get>>;
  try {
    result = await get(AbortSignal.timeout(ARR_TIMEOUT_MS));
  } catch (error) {
    // Name the kind of failure, but never surface the underlying error: it may contain the host.
    throw new ArrRequestError(`${label} request failed: ${failureKind(error)}`);
  }
  if (!result.response.ok) {
    throw new ArrRequestError(`${label} request failed: HTTP ${result.response.status}`);
  }
  return result.data;
}

function failureKind(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timed out";
  // openapi-fetch parses OK responses as JSON, so a non-JSON body (e.g. a login page) lands here.
  if (error instanceof SyntaxError) return "invalid response";
  return "network error";
}

import "server-only";

/**
 * A failed request to Radarr/Sonarr, or the TMDB poster fetch in poster.ts / movie-add.ts. Messages never
 * contain the host, URL, key or response body, so they are safe to log. "unconfigured" means the connection
 * has not been saved in Settings yet, so no request was sent.
 */
export type ArrFailureKind = "timeout" | "invalid" | "network" | "http" | "unconfigured";

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
 * so an "unconfigured" error surfaces as-is instead of as a network error.
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

/** Runs a list request and checks the reply is a list. Shared by the Radarr and Sonarr modules. */
export async function getList<T>(
  label: string,
  get: (signal: AbortSignal) => Promise<{ data?: T[]; response: Response }>,
  options?: { timeoutMs?: number },
): Promise<T[]> {
  const data = await arrRequest(label, get, options);
  if (!Array.isArray(data)) throw new ArrRequestError(`${label} response was not a list`, "invalid");
  return data;
}

/** Deleting many movies with their files can take a while on a NAS, so deletes get longer than the default. */
export const DELETE_TIMEOUT_MS = 120_000;

// "unconfigured" never comes from a request, so it has no entry here.
const FAILURE_TEXT: Record<Exclude<ArrFailureKind, "http" | "unconfigured">, string> = {
  timeout: "timed out",
  invalid: "invalid response",
  network: "network error",
};

function failureKind(error: unknown): Exclude<ArrFailureKind, "http" | "unconfigured"> {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  // openapi-fetch parses OK responses as JSON, so a non-JSON body (e.g. a login page) lands here.
  if (error instanceof SyntaxError) return "invalid";
  return "network";
}

/**
 * A settled fetch's value, or null when the request to Radarr or Sonarr failed. A failure is logged as `label: message`
 * and the other side can still show. Anything that isn't an ArrRequestError (a bug) is rethrown.
 */
export function settledOrNull<T>(result: PromiseSettledResult<T | null>, label: string): T | null {
  if (result.status === "fulfilled") return result.value;
  if (!(result.reason instanceof ArrRequestError)) throw result.reason;
  // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
  console.error(`${label}: ${result.reason.message}`);
  return null;
}

/**
 * The text a write action shows after its Radarr or Sonarr request failed. A 4xx means the app refused the change, so the
 * user can try again. Anything else (a timeout, a 5xx, a broken reply) may have been done anyway, so the text says so and
 * tells the user what to check. `outcome.done` completes "It may still have been ..." and `outcome.check` completes "so ...".
 */
export function writeFailureMessage(
  error: ArrRequestError,
  appName: "Radarr" | "Sonarr",
  outcome: { done: string; check: string },
): string {
  if (error.kind === "unconfigured") return `${appName} isn't set up yet. An admin can add it in Settings.`;
  if (error.status !== undefined && error.status >= 400 && error.status < 500) {
    return `${appName} didn't accept it. Try again.`;
  }
  return `${appName} didn't confirm it. It may still have been ${outcome.done}, so ${outcome.check}.`;
}

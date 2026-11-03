import "server-only";
import { z } from "zod";
import { env } from "@/server/env";
import { getPlexClientId } from "./client-id";

// Typed calls to plex.tv for Plex admin sign-in, using Plex's PIN flow. Every request is made as the one
// fixed MediaHub client id. Plex has no generated types, so every reply is checked with Zod and only the
// fields below are kept. The Plex token is used briefly inside the sign-in callback, is sent only in the
// X-Plex-Token header, and is never stored or logged.

const PLEX_BASE = "https://plex.tv";
const AUTH_APP_URL = "https://app.plex.tv/auth#?";
const PLEX_PRODUCT = "MediaHub";
const PLEX_TIMEOUT_MS = 10_000;

export type PlexFailureKind = "timeout" | "network" | "invalid" | "http";

/**
 * A failed request to plex.tv. Messages name the step and the kind or status only. They never contain
 * a token, URL query or response body, so they are safe to log.
 */
export class PlexRequestError extends Error {
  constructor(
    message: string,
    readonly kind: PlexFailureKind,
    /** Set only when plex.tv answered with a non-OK status. */
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

function failureKind(error: unknown): Exclude<PlexFailureKind, "http"> {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (error instanceof SyntaxError) return "invalid";
  return "network";
}

const PinSchema = z.object({ id: z.number().int(), code: z.string() });
const PinStatusSchema = z.object({ authToken: z.string().nullish() });
const UserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  email: z.string().nullish(),
});
const ResourceSchema = z.object({
  name: z.string().nullish(),
  provides: z.string().nullish(),
  owned: z.boolean().nullish(),
  clientIdentifier: z.string().nullish(),
});

type PlexFetchOptions = {
  path: string;
  method?: "GET" | "POST";
  token?: string;
  query?: Record<string, string>;
};

/** The one place every plex.tv request goes through: headers, timeout, no redirects, and Zod validation. */
async function plexFetch<T>(step: string, schema: z.ZodType<T>, options: PlexFetchOptions): Promise<T> {
  const url = new URL(options.path, PLEX_BASE);
  for (const [name, value] of Object.entries(options.query ?? {})) url.searchParams.set(name, value);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Plex-Client-Identifier": getPlexClientId(),
    "X-Plex-Product": PLEX_PRODUCT,
  };
  if (options.token) headers["X-Plex-Token"] = options.token;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(PLEX_TIMEOUT_MS),
    });
  } catch (error) {
    // Name the kind of failure, but never surface the underlying error: it may contain the URL.
    const kind = failureKind(error);
    throw new PlexRequestError(`${step} request failed: ${FAILURE_TEXT[kind]}`, kind);
  }
  if (!response.ok) {
    throw new PlexRequestError(`${step} request failed: HTTP ${response.status}`, "http", response.status);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    const kind = failureKind(error);
    throw new PlexRequestError(`${step} request failed: ${FAILURE_TEXT[kind]}`, kind);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new PlexRequestError(`${step} response was not as expected`, "invalid");
  return parsed.data;
}

/** Starts a sign-in. The code is approved in the browser, then checkPin() reads the token back. */
export async function createPin(): Promise<{ id: number; code: string }> {
  const pin = await plexFetch("Plex create PIN", PinSchema, {
    path: "/api/v2/pins",
    method: "POST",
    query: { strong: "true" },
  });
  return { id: pin.id, code: pin.code };
}

/**
 * The address the admin opens to approve the PIN. Plex sends the browser back to `forwardPath`, which is
 * resolved against MediaHub's own BETTER_AUTH_URL, so the return address can never point at another site.
 */
export function authAppUrl({ code, forwardPath }: { code: string; forwardPath?: string }): string {
  const params = new URLSearchParams({
    clientID: getPlexClientId(),
    code,
    "context[device][product]": PLEX_PRODUCT,
  });
  if (forwardPath !== undefined) params.set("forwardUrl", ownUrl(forwardPath));
  return `${AUTH_APP_URL}${params.toString()}`;
}

/** An absolute URL on MediaHub's own origin. Throws for anything that isn't a plain same-origin path. */
function ownUrl(path: string): string {
  const base = new URL(env().BETTER_AUTH_URL);
  const url = new URL(path, base);
  if (!path.startsWith("/") || path.startsWith("//") || url.origin !== base.origin) {
    throw new Error("forwardPath must be a path on MediaHub's own address.");
  }
  return url.toString();
}

/** The Plex token once the admin has approved the PIN, or null before that. */
export async function checkPin(pinId: number): Promise<string | null> {
  const pin = await plexFetch("Plex PIN check", PinStatusSchema, {
    path: `/api/v2/pins/${pinId}`,
  });
  return pin.authToken || null;
}

/** The signed-in Plex account. `email` is null when plex.tv doesn't return one. */
export async function getPlexAccount(token: string): Promise<{ id: number; username: string; email: string | null }> {
  const user = await plexFetch("Plex account", UserSchema, {
    path: "/api/v2/user",
    token,
  });
  return { id: user.id, username: user.username, email: user.email ?? null };
}

/** Servers the account owns. Shared servers and other device types are left out. */
export async function getOwnedServers(token: string): Promise<{ clientIdentifier: string; name: string }[]> {
  const resources = await plexFetch("Plex resources", z.array(ResourceSchema), {
    path: "/api/v2/resources",
    query: { includeHttps: "1" },
    token,
  });
  const servers: { clientIdentifier: string; name: string }[] = [];
  for (const resource of resources) {
    const isOwnedServer = resource.owned === true && (resource.provides ?? "").split(",").includes("server");
    // An owned server with missing details can't be picked or matched, so it is skipped, not fatal.
    if (!isOwnedServer || !resource.clientIdentifier || !resource.name) continue;
    servers.push({ clientIdentifier: resource.clientIdentifier, name: resource.name });
  }
  return servers;
}

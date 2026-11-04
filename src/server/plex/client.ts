import "server-only";
import { z } from "zod";
import { env } from "@/server/env";
import { getPlexClientId } from "./client-id";
import { PlexRequestError, transportError } from "./errors";

export { PlexRequestError };

// Typed calls to plex.tv for Plex admin sign-in (PIN flow) and for the Plex data connection. Sign-in calls are
// made as the one fixed sign-in client id; data-connection calls pass their own client id (see caller below).
// Plex has no generated types, so every reply is checked with Zod and only the fields below are kept. Tokens are
// sent only in the X-Plex-Token header, and are never stored here or logged.

const PLEX_BASE = "https://plex.tv";
const AUTH_APP_URL = "https://app.plex.tv/auth#?";
const PLEX_PRODUCT = "MediaHub";
const PLEX_TIMEOUT_MS = 10_000;

/**
 * Which device a plex.tv call is made as. Omitted, it is the sign-in client id and product. The product name must be
 * the same on every call for that device, including the approval link (authAppUrl).
 */
export type PlexCaller = { clientId?: string; product?: string };

const PinSchema = z.object({ id: z.number().int(), code: z.string() });
const PinStatusSchema = z.object({ authToken: z.string().nullish() });
const UserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  email: z.string().nullish(),
});
const ConnectionSchema = z.object({
  protocol: z.string(),
  address: z.string(),
  port: z.number().int(),
  uri: z.string(),
  local: z.boolean(),
  relay: z.boolean(),
  IPv6: z.boolean(),
});
const ResourceSchema = z.object({
  name: z.string().nullish(),
  provides: z.string().nullish(),
  owned: z.boolean().nullish(),
  clientIdentifier: z.string().nullish(),
});
// The data connection needs each server's addresses and access token. Sign-in never reads them, so a shape problem
// here can't break sign-in.
const DataResourceSchema = ResourceSchema.extend({
  accessToken: z.string().nullish(),
  connections: z.array(ConnectionSchema).nullish(),
});

/** One address a Plex server listens on, as plex.tv reports it. */
export type PlexConnection = z.infer<typeof ConnectionSchema>;

type PlexFetchOptions = {
  path: string;
  method?: "GET" | "POST";
  token?: string;
  query?: Record<string, string>;
  clientId?: string;
  product?: string;
};

/** The one place every plex.tv request goes through: headers, timeout, no redirects, and Zod validation. */
async function plexFetch<T>(step: string, schema: z.ZodType<T>, options: PlexFetchOptions): Promise<T> {
  const url = new URL(options.path, PLEX_BASE);
  for (const [name, value] of Object.entries(options.query ?? {})) url.searchParams.set(name, value);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Plex-Client-Identifier": options.clientId ?? getPlexClientId(),
    "X-Plex-Product": options.product ?? PLEX_PRODUCT,
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
    throw transportError(step, error);
  }
  if (!response.ok) {
    throw new PlexRequestError(`${step} request failed: HTTP ${response.status}`, "http", response.status);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    throw transportError(step, error);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new PlexRequestError(`${step} response was not as expected`, "invalid");
  return parsed.data;
}

/** Starts a sign-in (or a data-connection approval). The code is approved in the browser, then checkPin() reads the token back. */
export async function createPin(caller: PlexCaller = {}): Promise<{ id: number; code: string }> {
  const pin = await plexFetch("Plex create PIN", PinSchema, {
    path: "/api/v2/pins",
    method: "POST",
    query: { strong: "true" },
    clientId: caller.clientId,
    product: caller.product,
  });
  return { id: pin.id, code: pin.code };
}

/**
 * The address the admin opens to approve the PIN. Plex sends the browser back to `forwardPath`, which is
 * resolved against MediaHub's own BETTER_AUTH_URL, so the return address can never point at another site.
 * The data connection passes its own client id and product name, and no forwardPath.
 */
export function authAppUrl({
  code,
  forwardPath,
  clientId,
  product,
}: {
  code: string;
  forwardPath?: string;
  clientId?: string;
  product?: string;
}): string {
  const params = new URLSearchParams({
    clientID: clientId ?? getPlexClientId(),
    code,
    "context[device][product]": product ?? PLEX_PRODUCT,
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
export async function checkPin(pinId: number, caller: PlexCaller = {}): Promise<string | null> {
  const pin = await plexFetch("Plex PIN check", PinStatusSchema, {
    path: `/api/v2/pins/${pinId}`,
    clientId: caller.clientId,
    product: caller.product,
  });
  return pin.authToken || null;
}

/** The signed-in Plex account. `email` is null when plex.tv doesn't return one. */
export async function getPlexAccount(
  token: string,
  caller: PlexCaller = {},
): Promise<{ id: number; username: string; email: string | null }> {
  const user = await plexFetch("Plex account", UserSchema, {
    path: "/api/v2/user",
    token,
    clientId: caller.clientId,
    product: caller.product,
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

/** A Plex server the approving account can see: owned, or shared with it. `accessToken` is that server's own token. */
export type VisibleServer = {
  clientIdentifier: string;
  name: string;
  owned: boolean;
  accessToken: string;
  connections: PlexConnection[];
};

/**
 * Every server the account can see in plex.tv's resource list, owned and shared alike. Entries that aren't servers,
 * or have no name, id or access token, are skipped. Each server's own accessToken is what it accepts, so it is
 * returned here for the caller to store (the PIN token only matches it for an owned server).
 */
export async function getVisibleServers(token: string, caller: PlexCaller = {}): Promise<VisibleServer[]> {
  const resources = await plexFetch("Plex resources", z.array(DataResourceSchema), {
    path: "/api/v2/resources",
    query: { includeHttps: "1" },
    token,
    clientId: caller.clientId,
    product: caller.product,
  });
  const servers: VisibleServer[] = [];
  for (const resource of resources) {
    const isServer = (resource.provides ?? "").split(",").includes("server");
    if (!isServer || !resource.clientIdentifier || !resource.name || !resource.accessToken) continue;
    servers.push({
      clientIdentifier: resource.clientIdentifier,
      name: resource.name,
      owned: resource.owned === true,
      accessToken: resource.accessToken,
      connections: resource.connections ?? [],
    });
  }
  return servers;
}

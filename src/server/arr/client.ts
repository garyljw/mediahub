import "server-only";
import createClient from "openapi-fetch";
import { getConnection, type ArrApp, type Connection } from "@/server/settings/connections";
import { ArrRequestError } from "./request";
import type { paths as RadarrPaths } from "./generated/radarr";
import type { paths as SonarrPaths } from "./generated/sonarr";

// Resolve global fetch at call time (not at client creation) so the client
// always uses the current fetch implementation.
//
// Redirects are refused: fetch forwards custom headers such as X-Api-Key to
// the redirect target, even cross-origin.
const callFetch = (request: Request) => globalThis.fetch(request);

let radarr: ReturnType<typeof createRadarrClient> | undefined;
let sonarr: ReturnType<typeof createSonarrClient> | undefined;

/** A client for the given connection. Not cached: the Settings test uses this for a one-off check. */
export function createRadarrClient({ url, apiKey }: Connection) {
  return createClient<RadarrPaths>({
    baseUrl: url,
    headers: { "X-Api-Key": apiKey },
    redirect: "error",
    fetch: callFetch,
  });
}

/** A client for the given connection. Not cached: the Settings test uses this for a one-off check. */
export function createSonarrClient({ url, apiKey }: Connection) {
  return createClient<SonarrPaths>({
    baseUrl: url,
    headers: { "X-Api-Key": apiKey },
    redirect: "error",
    fetch: callFetch,
  });
}

// Callers are async functions, so this throw reaches them as a rejected promise.
function unconfigured(app: ArrApp): ArrRequestError {
  const name = app === "radarr" ? "Radarr" : "Sonarr";
  return new ArrRequestError(`${name} isn't set up`, "unconfigured");
}

/** Typed Radarr client from the saved connection. The API key is sent only in the X-Api-Key header. */
export function radarrClient() {
  if (!radarr) {
    const connection = getConnection("radarr");
    if (!connection) throw unconfigured("radarr");
    radarr = createRadarrClient(connection);
  }
  return radarr;
}

/** Typed Sonarr client from the saved connection. The API key is sent only in the X-Api-Key header. */
export function sonarrClient() {
  if (!sonarr) {
    const connection = getConnection("sonarr");
    if (!connection) throw unconfigured("sonarr");
    sonarr = createSonarrClient(connection);
  }
  return sonarr;
}

/** Drops the cached clients so the next call reads the saved connection again. Call after saving one. */
export function resetArrClients(): void {
  radarr = undefined;
  sonarr = undefined;
}

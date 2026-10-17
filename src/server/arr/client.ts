import "server-only";
import createClient from "openapi-fetch";
import { env } from "@/server/env";
import type { paths as RadarrPaths } from "./generated/radarr";
import type { paths as SonarrPaths } from "./generated/sonarr";

// Resolve global fetch at call time (not at client creation) so the client
// always uses the current fetch implementation.
//
// Redirects are refused: fetch forwards custom headers such as X-Api-Key to
// the redirect target, even cross-origin.
const callFetch = (request: Request) => globalThis.fetch(request);

let radarr: ReturnType<typeof createClient<RadarrPaths>> | undefined;
let sonarr: ReturnType<typeof createClient<SonarrPaths>> | undefined;

/** Typed Radarr client. The API key is sent only in the X-Api-Key header. */
export function radarrClient() {
  if (!radarr) {
    const { RADARR_URL, RADARR_API_KEY } = env();
    radarr = createClient<RadarrPaths>({
      baseUrl: RADARR_URL,
      headers: { "X-Api-Key": RADARR_API_KEY },
      redirect: "error",
      fetch: callFetch,
    });
  }
  return radarr;
}

/** Typed Sonarr client. The API key is sent only in the X-Api-Key header. */
export function sonarrClient() {
  if (!sonarr) {
    const { SONARR_URL, SONARR_API_KEY } = env();
    sonarr = createClient<SonarrPaths>({
      baseUrl: SONARR_URL,
      headers: { "X-Api-Key": SONARR_API_KEY },
      redirect: "error",
      fetch: callFetch,
    });
  }
  return sonarr;
}

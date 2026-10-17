import "server-only";
import { radarrClient, sonarrClient } from "./client";
import type { components as RadarrComponents } from "./generated/radarr";
import type { components as SonarrComponents } from "./generated/sonarr";

export type ArrStatus = { version: string; appName: string };

type SystemResource =
  | RadarrComponents["schemas"]["SystemResource"]
  | SonarrComponents["schemas"]["SystemResource"];

async function statusFor(
  name: "Radarr" | "Sonarr",
  get: () => Promise<{ data?: SystemResource; response: Response }>,
): Promise<ArrStatus> {
  let result: Awaited<ReturnType<typeof get>>;
  try {
    result = await get();
  } catch {
    // Do not surface the underlying error: it may contain the host.
    throw new Error(`${name} status request failed: network error`);
  }
  const { data, response } = result;
  if (!response.ok) {
    throw new Error(`${name} status request failed: HTTP ${response.status}`);
  }
  if (!data?.version || !data.appName) {
    throw new Error(`${name} status response missing version or appName`);
  }
  // Return only the fields the UI needs.
  return { version: data.version, appName: data.appName };
}

// Build the client outside statusFor's try so env() config errors surface as-is.
export async function getRadarrStatus(): Promise<ArrStatus> {
  const client = radarrClient();
  return statusFor("Radarr", () => client.GET("/api/v3/system/status"));
}

export async function getSonarrStatus(): Promise<ArrStatus> {
  const client = sonarrClient();
  return statusFor("Sonarr", () => client.GET("/api/v3/system/status"));
}

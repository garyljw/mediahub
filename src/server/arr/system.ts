import "server-only";
import { radarrClient, sonarrClient } from "./client";
import { ArrRequestError, arrRequest } from "./request";
import type { components as RadarrComponents } from "./generated/radarr";
import type { components as SonarrComponents } from "./generated/sonarr";

export type ArrStatus = { version: string; appName: string };

type SystemResource =
  | RadarrComponents["schemas"]["SystemResource"]
  | SonarrComponents["schemas"]["SystemResource"];

async function statusFor(
  name: "Radarr" | "Sonarr",
  get: (signal: AbortSignal) => Promise<{ data?: SystemResource; response: Response }>,
): Promise<ArrStatus> {
  const data = await arrRequest(`${name} status`, get);
  if (!data?.version || !data.appName) {
    throw new ArrRequestError(`${name} status response missing version or appName`, "invalid");
  }
  // Return only the fields the UI needs.
  return { version: data.version, appName: data.appName };
}

// Build the client outside statusFor's try so env() config errors surface as-is.
export async function getRadarrStatus(): Promise<ArrStatus> {
  const client = radarrClient();
  return statusFor("Radarr", (signal) => client.GET("/api/v3/system/status", { signal }));
}

export async function getSonarrStatus(): Promise<ArrStatus> {
  const client = sonarrClient();
  return statusFor("Sonarr", (signal) => client.GET("/api/v3/system/status", { signal }));
}

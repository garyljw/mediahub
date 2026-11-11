import "server-only";
import { radarrClient, sonarrClient } from "./client";
import { ArrRequestError, arrRequest } from "./request";
import type { components as RadarrComponents } from "./generated/radarr";
import type { components as SonarrComponents } from "./generated/sonarr";

export type ArrDisk = { path: string; label: string | null; freeSpace: number; totalSpace: number };

type DiskSpaceResource =
  | RadarrComponents["schemas"]["DiskSpaceResource"]
  | SonarrComponents["schemas"]["DiskSpaceResource"];

async function disksFor(
  name: "Radarr" | "Sonarr",
  get: (signal: AbortSignal) => Promise<{ data?: DiskSpaceResource[]; response: Response }>,
): Promise<ArrDisk[]> {
  const data = await arrRequest(`${name} disk space`, get);
  if (!Array.isArray(data)) {
    throw new ArrRequestError(`${name} disk space response was not a list`, "invalid");
  }
  const disks: ArrDisk[] = [];
  for (const item of data) {
    const { path, label, freeSpace, totalSpace } = item;
    if (!path) continue;
    if (typeof freeSpace !== "number" || !Number.isFinite(freeSpace)) continue;
    if (typeof totalSpace !== "number" || !Number.isFinite(totalSpace) || totalSpace <= 0) continue;
    // Return only the fields the UI needs.
    disks.push({ path, label: label ? label : null, freeSpace, totalSpace });
  }
  return disks;
}

// Build the client outside disksFor's try so an unconfigured app's error surfaces as-is.
export async function getRadarrDiskSpace(): Promise<ArrDisk[]> {
  const client = radarrClient();
  return disksFor("Radarr", (signal) => client.GET("/api/v3/diskspace", { signal }));
}

export async function getSonarrDiskSpace(): Promise<ArrDisk[]> {
  const client = sonarrClient();
  return disksFor("Sonarr", (signal) => client.GET("/api/v3/diskspace", { signal }));
}

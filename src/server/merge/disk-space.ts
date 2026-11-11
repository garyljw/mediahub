import "server-only";
import type { ArrDisk } from "../arr/disk-space";

export type MergedDisks = { disks: ArrDisk[]; unavailable: ("Radarr" | "Sonarr")[] };

/**
 * Combines the disks Radarr and Sonarr report. A null list means that app couldn't be loaded.
 * The same path (compared ignoring case, as on Windows) is shown once, with Radarr's numbers.
 * Different paths stay separate rows, even when they are shares on the same server.
 */
export function mergeDisks(radarr: ArrDisk[] | null, sonarr: ArrDisk[] | null): MergedDisks {
  const unavailable: ("Radarr" | "Sonarr")[] = [];
  if (radarr === null) unavailable.push("Radarr");
  if (sonarr === null) unavailable.push("Sonarr");

  const byPath = new Map<string, ArrDisk>();
  for (const disk of [...(radarr ?? []), ...(sonarr ?? [])]) {
    const key = disk.path.toLowerCase();
    if (!byPath.has(key)) byPath.set(key, disk);
  }
  const disks = [...byPath.values()].sort((a, b) => {
    const x = a.path.toLowerCase();
    const y = b.path.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return { disks, unavailable };
}

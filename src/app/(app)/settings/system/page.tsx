import { requirePageUser } from "@/server/authz";
import { getRadarrDiskSpace, getSonarrDiskSpace } from "@/server/arr/disk-space";
import { loadOrNull } from "@/server/arr/load-or-null";
import { mergeDisks } from "@/server/merge/disk-space";
import { formatSize } from "@/components/library/format";

export const metadata = { title: "System" };
// The page asks Radarr and Sonarr before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

export default async function SystemPage() {
  await requirePageUser("admin");
  const [radarr, sonarr] = await Promise.all([
    loadOrNull(getRadarrDiskSpace, "System disk space (Radarr)"),
    loadOrNull(getSonarrDiskSpace, "System disk space (Sonarr)"),
  ]);
  const { disks, unavailable } = mergeDisks(radarr, sonarr);

  let note: string | null = null;
  if (unavailable.length === 2) note = "Couldn't load disk space from Radarr or Sonarr.";
  else if (unavailable.length === 1) {
    const other = unavailable[0] === "Radarr" ? "Sonarr" : "Radarr";
    note = `Couldn't reach ${unavailable[0]}, so this list comes from ${other} only.`;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">System</h1>
      <h2 className="mt-6 text-lg font-medium">Disk space</h2>

      {note && <p className="mt-2 text-sm text-muted-foreground">{note}</p>}
      {unavailable.length < 2 && disks.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          {unavailable.length === 0
            ? "Radarr and Sonarr reported no disks."
            : `${unavailable[0] === "Radarr" ? "Sonarr" : "Radarr"} reported no disks.`}
        </p>
      )}

      {disks.length > 0 && (
        <ul className="mt-4 divide-y rounded-lg border">
          {disks.map((disk) => {
            const usedPercent = Math.min(100, Math.max(0, Math.round((1 - disk.freeSpace / disk.totalSpace) * 100)));
            const low = disk.freeSpace / disk.totalSpace < 0.1;
            return (
              <li key={disk.path.toLowerCase()} className="space-y-2 px-4 py-3">
                <div>
                  <span className="font-medium">{disk.path}</span>
                  {disk.label && <span className="ml-2 text-sm text-muted-foreground">{disk.label}</span>}
                </div>
                <div
                  role="meter"
                  aria-label={`${disk.path} used`}
                  aria-valuenow={usedPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-2 rounded-full bg-muted"
                >
                  <div
                    className={`h-full rounded-full ${low ? "bg-destructive" : "bg-primary"}`}
                    style={{ width: `${usedPercent}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {/* formatSize shows a dash for 0, which would make a full disk look unknown. */}
                  {disk.freeSpace > 0 ? formatSize(disk.freeSpace) : "0 B"} free of {formatSize(disk.totalSpace)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

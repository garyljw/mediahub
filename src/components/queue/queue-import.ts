// The Force import dialog's file shape. Pure, and safe to import from both the server merge and the client dialog, so it
// must not import server-only code at runtime (type imports only).

/**
 * One file the app found in a download, as the admin's Force import dialog shows it. Built on the server. Paths,
 * folder names and download ids never leave the server, so they are not in this type.
 */
export type ImportCandidate = {
  /** The Radarr or Sonarr manual import id. Unique within one list. */
  id: number;
  /** The file's relative path, else its name, else "Unknown file". */
  name: string;
  /** What the app matched the file to, or null when it matched nothing. */
  match: string | null;
  /** The quality name, or null when the app didn't give one. */
  quality: string | null;
  /** The file size in bytes, or null when it is zero or missing. */
  sizeBytes: number | null;
  /** The app's reasons it won't import the file as it is. Trimmed, non-empty and de-duplicated. */
  rejections: string[];
  /** True when the app would tick this file on its own manual import screen. The admin may still untick it. */
  importable: boolean;
  /**
   * What the file would be imported as: "movie-<id>" or one "episode-<id>" per episode. [] when not importable. The
   * dialog uses it to warn when two ticked files are for the same movie or episode. The server checks again.
   */
  targets: string[];
};

/**
 * The ids of the ticked files that share a target (the same movie, or an episode) with another ticked file. Pure. The
 * dialog marks them and holds the import until one is unticked. The server refuses such a pick anyway.
 */
export function clashingFiles(files: readonly ImportCandidate[], ticked: ReadonlySet<number>): Set<number> {
  const owners = new Map<string, number[]>();
  for (const file of files) {
    if (!ticked.has(file.id)) continue;
    for (const target of new Set(file.targets)) {
      const ids = owners.get(target);
      if (ids) ids.push(file.id);
      else owners.set(target, [file.id]);
    }
  }
  const clashing = new Set<number>();
  for (const ids of owners.values()) {
    if (ids.length > 1) for (const id of ids) clashing.add(id);
  }
  return clashing;
}

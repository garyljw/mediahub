import "server-only";
import type { components as RadarrComponents } from "./generated/radarr";
import type { components as SonarrComponents } from "./generated/sonarr";

/** A root folder the add dialog can choose. The browser sends its id; the server resolves the path. */
export type RootFolderOption = { id: number; path: string; freeSpace: number | null };

/**
 * Pure: root folders to dialog options. Skips entries without a numeric id or a path. Sorted by path.
 * Takes Radarr's or Sonarr's root folder resources.
 */
export function toRootFolderOptions(
  folders: RadarrComponents["schemas"]["RootFolderResource"][] | SonarrComponents["schemas"]["RootFolderResource"][],
): RootFolderOption[] {
  const options: RootFolderOption[] = [];
  for (const folder of folders) {
    if (typeof folder.id !== "number" || !folder.path) continue;
    options.push({
      id: folder.id,
      path: folder.path,
      freeSpace: typeof folder.freeSpace === "number" ? folder.freeSpace : null,
    });
  }
  options.sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true }));
  return options;
}

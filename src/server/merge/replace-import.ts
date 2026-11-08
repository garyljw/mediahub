import "server-only";

/**
 * The start of each reason Radarr and Sonarr give for refusing a file because it isn't better than the file already in
 * the library. Checked against UpgradeSpecification.cs in both apps' develop source (Radarr: "movie file", Sonarr:
 * "episode file(s)"). Only these three are a replacement case: any other rejection (a sample, a wrong match) is not.
 */
export const NOT_AN_UPGRADE_PREFIXES = [
  "Not an upgrade for existing ",
  "Not a quality revision upgrade for existing ",
  "Not a Custom Format upgrade for existing ",
] as const;

/** A positive integer, as the ManualImport command needs for a file id. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Pure: the ids of the scanned files that can be imported over the existing file. A file qualifies when it has at least
 * one rejection and every rejection is one of the NOT_AN_UPGRADE_PREFIXES. A file with no rejections is left alone (the
 * app would import it itself), and so is a file with any other rejection. Ids that aren't positive integers are skipped.
 */
export function replaceableFileIds(
  items: readonly { id?: number | null; rejections?: readonly { reason?: string | null }[] | null }[],
): number[] {
  const ids: number[] = [];
  for (const item of items) {
    const rejections = item.rejections ?? [];
    if (rejections.length === 0) continue;
    const onlyUpgradeRejections = rejections.every(
      (rejection) =>
        typeof rejection.reason === "string" && NOT_AN_UPGRADE_PREFIXES.some((prefix) => rejection.reason?.startsWith(prefix)),
    );
    if (onlyUpgradeRejections && isPositiveInteger(item.id)) ids.push(item.id);
  }
  return ids;
}

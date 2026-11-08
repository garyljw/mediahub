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

// The warnings Radarr and Sonarr put on a finished download they won't import automatically, because the download was
// matched to its movie or series by ID rather than by its name. Checked against CompletedDownloadService.Check in both
// apps' develop source: the grab history found the movie or series, and the release was matched by ID, so the app
// blocks it and calls trackedDownload.Warn. Only these prefixes count. The title mismatch warnings do not.
export const SONARR_MATCHED_BY_ID_PREFIX =
  "Found matching series via grab history, but release was matched to series by ID.";
export const RADARR_MATCHED_BY_ID_PREFIX =
  "Found matching movie via grab history, but release was matched to movie by ID.";

/** The scanned file fields the matched-by-ID check reads. Sonarr's files carry a series, Radarr's a movie. */
type ScannedFile = {
  id?: number | null;
  rejections?: readonly { reason?: string | null }[] | null;
  series?: { id?: number | null } | null;
  movie?: { id?: number | null } | null;
};

/**
 * What the scan of one matched-by-ID download allows: `ok: true` with the ids of the files to import, or `ok: false` when
 * the scan holds a file for another series or movie, so nothing in the download is imported.
 */
export type MatchedByIdFiles = { ok: true; ids: number[] } | { ok: false };

/**
 * Pure: the files of a matched-by-ID download that can be imported for the series or movie the queue item names. A file
 * qualifies when it has no rejections, has a positive integer id, and belongs to expectedId. A file with no rejections
 * but no owner is left out, since it can't be shown to match. If any file in the scan belongs to a different series or
 * movie, the whole download is refused, even when that file has rejections. An expectedId that isn't a positive integer
 * refuses everything.
 */
export function matchedByIdFileIds(items: readonly ScannedFile[], expectedId: number): MatchedByIdFiles {
  if (!isPositiveInteger(expectedId)) return { ok: false };
  const ids: number[] = [];
  for (const item of items) {
    const owner = item.series?.id ?? item.movie?.id ?? null;
    if (owner !== null && owner !== expectedId) return { ok: false };
    if (owner !== expectedId) continue;
    if ((item.rejections ?? []).length > 0) continue;
    if (isPositiveInteger(item.id)) ids.push(item.id);
  }
  return { ok: true, ids };
}

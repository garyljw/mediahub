"use server";

import { RedirectType, redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import {
  SeasonNotFoundError,
  searchEpisode,
  searchSeason,
  applySeriesMonitorPreset,
  setEpisodeMonitored,
  setSeasonMonitored,
} from "@/server/arr/episodes";
import { deleteEpisodeFiles, getDeleteSettings, planFileDelete, unmonitorEpisodes } from "@/server/arr/episode-files";
import { deleteSeries, editSeries, listSeriesQualityProfiles, type SeriesEdit } from "@/server/arr/series";
import { ArrRequestError } from "@/server/arr/request";
import { ReleaseGrabError, grabWasRefused } from "@/server/arr/releases";
import { grabSeriesRelease as sendSeriesRelease, searchSeriesReleases } from "@/server/arr/series-releases";
import { recordReplaceGrab } from "@/server/replace/replace-grabs";
import type { GrabResult, ReleaseSearchResult } from "@/components/library/release";
import { SERIES_MONITOR_OPTIONS, SERIES_TYPE_OPTIONS } from "@/components/tv/series-add";
import { NEW_ITEM_MONITOR_OPTIONS } from "@/components/tv/series-edit";

export type { GrabResult, ReleaseSearchResult };

export type ActionResult = { ok: true } | { ok: false; error: string };

// strictObject rejects unknown keys. Only ids, a season number and a boolean cross from the browser.
const EpisodeMonitorInput = z.strictObject({
  episodeId: z.number().int().positive(),
  monitored: z.boolean(),
});

const SeasonMonitorInput = z.strictObject({
  seriesId: z.number().int().positive(),
  seasonNumber: z.number().int().min(0),
  monitored: z.boolean(),
});

const SeasonSearchInput = z.strictObject({
  seriesId: z.number().int().positive(),
  seasonNumber: z.number().int().min(0),
});

const EpisodeSearchInput = z.strictObject({
  episodeId: z.number().int().positive(),
});

/**
 * The message for a failed monitoring change. Before the write is sent, nothing changed, so a plain retry is fine.
 * After it is sent, only a 4xx answer means Sonarr refused it: a timeout, a dropped connection, an odd reply or a
 * 5xx (from Sonarr or a proxy) can all come after Sonarr saved the change, so the user must check first.
 */
function monitorFailure(error: ArrRequestError, sent: boolean): string {
  if (!sent) return "Couldn't load the series from Sonarr, so nothing changed. Try again.";
  if (error.status !== undefined && error.status >= 400 && error.status < 500) {
    return "Sonarr didn't accept the change. Try again.";
  }
  if (error.kind === "timeout") {
    return "Sonarr took too long to answer. The change may still have been saved, so reload the page to check.";
  }
  return "Sonarr didn't confirm the change. It may still have been saved, so reload the page to check.";
}

/**
 * Sets one episode's monitored flag (admin only). The role check runs first, inside try, and the catch always
 * returns or throws. src/app/server-actions-auth.test.ts enforces this shape for every action.
 */
export async function setEpisodeMonitoring(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to change monitoring." };
    throw error;
  }

  const parsed = EpisodeMonitorInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid change." };

  try {
    await setEpisodeMonitored(parsed.data.episodeId, parsed.data.monitored);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Episode monitor: ${error.message}`);
    // The write is the only request, so it counts as sent.
    return { ok: false, error: monitorFailure(error, true) };
  }

  // The page reads Sonarr on every request and nothing is cached, so refresh() shows the new flag.
  refresh();
  return { ok: true };
}

/**
 * Sets one season's monitored flag (admin only). Same shape as setEpisodeMonitoring. A season or series that
 * Sonarr no longer has gets its own message.
 */
export async function setSeasonMonitoring(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to change monitoring." };
    throw error;
  }

  const parsed = SeasonMonitorInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid change." };
  const { seriesId, seasonNumber, monitored } = parsed.data;

  // Set just before the PUT, so a failure on the GET before it is known to have changed nothing.
  let sent = false;
  try {
    await setSeasonMonitored(seriesId, seasonNumber, monitored, () => {
      sent = true;
    });
  } catch (error) {
    if (error instanceof SeasonNotFoundError) return { ok: false, error: "That season no longer exists." };
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Season monitor: ${error.message}`);
    return { ok: false, error: monitorFailure(error, sent) };
  }

  refresh();
  return { ok: true };
}

/**
 * Asks Sonarr to search for one season's monitored episodes (admin and requester). The role check runs first,
 * inside try, and the catch always returns or throws. Sonarr only queues the search, and nothing on the page
 * changes, so there is no refresh().
 */
export async function searchSeasonNow(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to search for episodes." };
    throw error;
  }

  const parsed = SeasonSearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };
  const { seriesId, seasonNumber } = parsed.data;

  try {
    await searchSeason(seriesId, seasonNumber);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Season search: ${error.message}`);
    // After a timeout Sonarr may have queued the search anyway, so don't tell the user to just retry.
    if (error.kind === "timeout") {
      return { ok: false, error: "Sonarr took too long to answer. The search may still have started, so check Sonarr before trying again." };
    }
    return { ok: false, error: "Sonarr didn't start the search. Try again." };
  }

  return { ok: true };
}

/**
 * Asks Sonarr to search for releases for one episode (admin and requester). Same shape as searchSeasonNow.
 */
export async function searchEpisodeNow(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to search for episodes." };
    throw error;
  }

  const parsed = EpisodeSearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };

  try {
    await searchEpisode(parsed.data.episodeId);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Episode search: ${error.message}`);
    // After a timeout Sonarr may have queued the search anyway, so don't tell the user to just retry.
    if (error.kind === "timeout") {
      return { ok: false, error: "Sonarr took too long to answer. The search may still have started, so check Sonarr before trying again." };
    }
    return { ok: false, error: "Sonarr didn't start the search. Try again." };
  }

  return { ok: true };
}

// Sonarr searches for one season or one episode, never for a series alone. This union is strict, so a series id by
// itself, a season with an episode id, and any extra key are all refused before Sonarr is asked. An episode search
// takes no series id: Sonarr finds the series from the episode.
const SeriesReleaseSearchInput = z.union([
  z.strictObject({
    seriesId: z.number().int().positive(),
    seasonNumber: z.number().int().min(0),
  }),
  z.strictObject({
    episodeId: z.number().int().positive(),
  }),
]);

/**
 * Asks Sonarr for interactive release search results for one season or one episode (admin only). Same shape as the
 * other actions: the role check runs first inside try, and the catch always returns or throws. Nothing on the page
 * changes, so there is no refresh(). The rows carry only what the dialog shows, plus the server's token.
 */
export async function findSeriesReleases(input: unknown): Promise<ReleaseSearchResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to pick releases." };
    throw error;
  }

  const parsed = SeriesReleaseSearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };

  try {
    const { rows, totals } = await searchSeriesReleases(parsed.data);
    return { ok: true, releases: rows, totals };
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Release search: ${error.message}`);
    if (error.kind === "timeout") {
      return { ok: false, error: "Sonarr took too long searching the indexers. Try again in a moment." };
    }
    if (error.kind === "http" && error.status === 404) {
      return { ok: false, error: "That season or episode is no longer in Sonarr. Close this and reload the page." };
    }
    return { ok: false, error: "Sonarr couldn't search the indexers. Try again." };
  }
}

// strictObject rejects unknown keys. The browser sends the token from a search result, and whether the admin ticked
// "Replace existing file". A non-boolean there is refused.
const SeriesReleaseGrabInput = z.strictObject({
  token: z.uuid(),
  replaceExisting: z.boolean().optional(),
});

/**
 * Remembers a grab for the auto-import worker. The app already accepted the grab, so a failure here is only logged,
 * and the caller still reports success. The guid is never sent to the browser.
 */
function rememberReplaceGrab(guid: string): void {
  try {
    recordReplaceGrab("sonarr", guid);
  } catch {
    console.error("Replace grab: couldn't remember the grab");
  }
}

/**
 * Sends a release from an earlier search to Sonarr's download client (admin only). Same shape as the other actions:
 * the role check runs first inside try, and the catch always returns or throws. The release is taken from the
 * server's cache, so the browser can only grab what Sonarr returned. Nothing on the page changes, so there is no
 * refresh().
 */
export async function grabSeriesRelease(input: unknown): Promise<GrabResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to pick releases." };
    throw error;
  }

  const parsed = SeriesReleaseGrabInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid grab." };

  try {
    const grabbed = await sendSeriesRelease(parsed.data.token);
    if (parsed.data.replaceExisting === true) rememberReplaceGrab(grabbed.guid);
    return { ok: true, title: grabbed.title };
  } catch (error) {
    // Sonarr answers 404 both when it no longer has the release and when it can't match it to episodes.
    if (error instanceof ReleaseGrabError) {
      return {
        ok: false,
        error: "Sonarr can no longer use that result: it may have expired, or Sonarr couldn't match it to episodes. Search again or pick another one.",
      };
    }
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Release grab: ${error.message}`);
    // A timeout or a dropped connection can mean Sonarr already sent the release, so don't invite a blind retry.
    if (error.kind === "timeout") {
      return {
        ok: false,
        error: "Sonarr took too long to answer. The release may still have been grabbed, so check the queue before trying again.",
      };
    }
    // Only a refusal means nothing was grabbed. A 5xx can come after the release reached the download client.
    if (grabWasRefused(error)) {
      if (error.status === 409) return { ok: false, error: "The indexer didn't hand over that release. Try again, or pick another one." };
      return { ok: false, error: "Sonarr didn't grab the release. Try again." };
    }
    return {
      ok: false,
      error: "Sonarr didn't confirm the grab. It may still have been sent, so check the queue before trying again.",
    };
  }
}

// Only the one series id crosses from the browser. strictObject rejects any other key, and the two booleans are
// required, so a missing choice can never be read as "no".
const SeriesItemDeleteInput = z.strictObject({
  seriesId: z.number().int().positive(),
  deleteFiles: z.boolean(),
  addImportListExclusion: z.boolean(),
});

export type DeleteResult = { ok: false; error: string };

/**
 * Deletes this series from Sonarr (admin only), for the series page. The role check runs first, and
 * the catch always returns or throws. On success it sends the browser back to Home. The redirect sits
 * outside the try, because redirect throws.
 */
export async function deleteSeriesItem(input: unknown): Promise<DeleteResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to delete series." };
    throw error;
  }

  const parsed = SeriesItemDeleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid delete." };
  const { seriesId, deleteFiles, addImportListExclusion } = parsed.data;

  try {
    await deleteSeries({ seriesIds: [seriesId], deleteFiles, addImportListExclusion });
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Series delete: ${error.message}`);
    // Sonarr may have deleted it anyway (certainly possible after a timeout), so re-read the page rather than keep
    // showing an item that might be gone. If it is gone, the page shows not-found.
    refresh();
    if (error.kind === "timeout") {
      return { ok: false, error: "Sonarr is taking a long time and may still be deleting. The page has been refreshed; check it before trying again." };
    }
    return { ok: false, error: "Sonarr didn't confirm the delete, so the series may already be gone. The page has been refreshed; check it before trying again." };
  }

  // replace, not push, so Back doesn't return to the deleted item's page.
  redirect("/", RedirectType.replace);
}


// Only the one series id and the fields the settings form offers cross from the browser. strictObject rejects any
// other key (such as a rootFolderPath or moveFiles). The refine requires at least one change, so an empty edit is refused.
const SeriesItemEditInput = z
  .strictObject({
    seriesId: z.number().int().positive(),
    qualityProfileId: z.number().int().positive().optional(),
    monitored: z.boolean().optional(),
    seriesType: z.enum(SERIES_TYPE_OPTIONS).optional(),
    seasonFolder: z.boolean().optional(),
    monitorNewItems: z.enum(NEW_ITEM_MONITOR_OPTIONS).optional(),
    episodeMonitoring: z.enum(SERIES_MONITOR_OPTIONS).optional(),
  })
  .refine(
    (input) =>
      input.qualityProfileId !== undefined ||
      input.monitored !== undefined ||
      input.seriesType !== undefined ||
      input.seasonFolder !== undefined ||
      input.monitorNewItems !== undefined ||
      input.episodeMonitoring !== undefined,
  )
  // "None" unmonitors the series, so asking for it together with monitored: true contradicts itself.
  .refine((input) => !(input.episodeMonitoring === "none" && input.monitored === true));

/**
 * Edits this series in Sonarr (admin only), for the series page. The role check is the first thing that runs. It sits
 * inside try so a denial returns { ok: false } instead of throwing. The catch always returns or throws, so nothing
 * after it runs without a passed check. src/app/server-actions-auth.test.ts enforces this shape for every action.
 */
export async function updateSeriesItem(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to edit series." };
    throw error;
  }

  const parsed = SeriesItemEditInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid edit." };

  const { seriesId, qualityProfileId, monitored, seriesType, seasonFolder, monitorNewItems, episodeMonitoring } = parsed.data;
  const edit: SeriesEdit = { seriesId };
  if (qualityProfileId !== undefined) edit.qualityProfileId = qualityProfileId;
  if (monitored !== undefined) edit.monitored = monitored;
  if (seriesType !== undefined) edit.seriesType = seriesType;
  if (seasonFolder !== undefined) edit.seasonFolder = seasonFolder;
  if (monitorNewItems !== undefined) edit.monitorNewItems = monitorNewItems;
  const hasEdit =
    qualityProfileId !== undefined ||
    monitored !== undefined ||
    seriesType !== undefined ||
    seasonFolder !== undefined ||
    monitorNewItems !== undefined;

  try {
    if (qualityProfileId !== undefined) {
      const profiles = await listSeriesQualityProfiles();
      if (!profiles.some((profile) => profile.id === qualityProfileId)) {
        // Re-render so the form offers Sonarr's current profiles instead of the deleted one.
        refresh();
        return { ok: false, error: "That quality profile no longer exists." };
      }
    }
    if (hasEdit) await editSeries(edit);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Series edit: ${error.message}`);
    // The preset is not sent after a failed edit.
    return { ok: false, error: "Sonarr didn't accept the change. Try again." };
  }

  if (episodeMonitoring !== undefined) {
    try {
      await applySeriesMonitorPreset(seriesId, episodeMonitoring);
    } catch (error) {
      if (!(error instanceof ArrRequestError)) throw error;
      // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
      console.error(`Series monitor preset: ${error.message}`);
      if (hasEdit) {
        // The edit was saved, so re-read the page to show it.
        refresh();
        return { ok: false, error: "Settings saved, but Sonarr didn't apply the episode monitoring change. Try again." };
      }
      return { ok: false, error: "Sonarr didn't apply the episode monitoring change. Try again." };
    }
  }

  // The series page reads Sonarr on every request and nothing is cached, so refresh() shows the new values.
  refresh();
  return { ok: true };
}

// Season (0 is Specials) or one episode, never both. Each branch is strict, so extra keys are refused.
const FileDeleteTarget = z.union([
  z.strictObject({ seriesId: z.number().int().positive(), seasonNumber: z.number().int().min(0) }),
  z.strictObject({ seriesId: z.number().int().positive(), episodeId: z.number().int().positive() }),
]);

const FileDeleteInput = z.union([
  z.strictObject({
    seriesId: z.number().int().positive(),
    seasonNumber: z.number().int().min(0),
    fileIds: z.array(z.number().int().positive()).min(1).max(500).refine((ids) => new Set(ids).size === ids.length),
    unmonitor: z.boolean(),
  }),
  z.strictObject({
    seriesId: z.number().int().positive(),
    episodeId: z.number().int().positive(),
    fileIds: z.array(z.number().int().positive()).min(1).max(500).refine((ids) => new Set(ids).size === ids.length),
    unmonitor: z.boolean(),
  }),
]);

const FILE_DELETE_DENIED = "You don't have permission to delete files.";

/** What the delete dialog shows. Labels, flags and ids only: no paths, and never the Recycle Bin path. */
export type FileDeletePreview =
  | {
      ok: true;
      fileIds: number[];
      fileCount: number;
      totalSize: number;
      episodes: { id: number; seasonNumber: number; episodeNumber: number; title: string; wanted: boolean }[];
      sonarrUnmonitorsDeleted: boolean;
      recycleBinSet: boolean;
    }
  | { ok: false; error: string };

/**
 * Shows what deleting one season's or one episode's files would remove (admin only). Writes nothing, so there is
 * no refresh(). The role check runs first, inside try, and the catch always returns or throws.
 */
export async function previewFileDelete(input: unknown): Promise<FileDeletePreview> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: FILE_DELETE_DENIED };
    throw error;
  }

  const parsed = FileDeleteTarget.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid delete." };
  const { seriesId } = parsed.data;
  const target = "episodeId" in parsed.data ? { episodeId: parsed.data.episodeId } : { seasonNumber: parsed.data.seasonNumber };

  try {
    const [plan, settings] = await Promise.all([planFileDelete(seriesId, target), getDeleteSettings()]);
    return {
      ok: true,
      fileIds: plan.fileIds,
      fileCount: plan.fileIds.length,
      totalSize: plan.totalSize,
      episodes: plan.episodes.map(({ id, seasonNumber, episodeNumber, title, wanted }) => ({
        id,
        seasonNumber,
        episodeNumber,
        title,
        wanted,
      })),
      sonarrUnmonitorsDeleted: settings.sonarrUnmonitorsDeleted,
      recycleBinSet: settings.recycleBinSet,
    };
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`File delete preview: ${error.message}`);
    return { ok: false, error: "Couldn't load the files from Sonarr. Try again." };
  }
}

/**
 * Deletes the downloaded files of one season or one episode, keeping the series in Sonarr (admin only). The plan is
 * rebuilt on the server and only the files in both the plan and the request are deleted, so the browser can't name
 * a file outside this series and target, or one the admin wasn't shown. When the admin chose to unmonitor and
 * Sonarr's own setting won't do it, the episodes are unmonitored first, so nothing can be grabbed in between.
 * Role check first, inside try; the catch always returns or throws.
 */
export async function deleteFiles(input: unknown): Promise<ActionResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: FILE_DELETE_DENIED };
    throw error;
  }

  const parsed = FileDeleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid delete." };
  const { seriesId, fileIds, unmonitor } = parsed.data;
  const target = "episodeId" in parsed.data ? { episodeId: parsed.data.episodeId } : { seasonNumber: parsed.data.seasonNumber };

  let toDelete: number[];
  let episodeIds: number[];
  let sonarrUnmonitors = true;
  try {
    const plan = await planFileDelete(seriesId, target);
    const planned = new Set(plan.fileIds);
    toDelete = fileIds.filter((id) => planned.has(id));
    const chosen = new Set(toDelete);
    episodeIds = plan.episodes.filter((episode) => chosen.has(episode.fileId)).map((episode) => episode.id);
    if (toDelete.length > 0 && unmonitor) sonarrUnmonitors = (await getDeleteSettings()).sonarrUnmonitorsDeleted;
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`File delete plan: ${error.message}`);
    return { ok: false, error: "Couldn't load the files from Sonarr, so nothing was deleted. Try again." };
  }

  if (toDelete.length === 0) {
    refresh();
    return { ok: false, error: "These files are already gone. The page has been refreshed." };
  }

  if (unmonitor && !sonarrUnmonitors) {
    try {
      await unmonitorEpisodes(episodeIds);
    } catch (error) {
      if (!(error instanceof ArrRequestError)) throw error;
      console.error(`Episode unmonitor: ${error.message}`);
      return { ok: false, error: "Sonarr didn't unmonitor the episodes, so nothing was deleted. Try again." };
    }
  }

  try {
    await deleteEpisodeFiles(toDelete);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    console.error(`Episode file delete: ${error.message}`);
    // Sonarr may have deleted some or all of them, so re-read the page.
    refresh();
    // When the episodes were unmonitored first, say so: they stay unmonitored although the delete failed.
    const unmonitored = unmonitor && !sonarrUnmonitors ? " The episodes were already unmonitored." : "";
    if (error.status === 409) {
      return { ok: false, error: `Sonarr can't reach the series' root folder, so nothing was deleted.${unmonitored}` };
    }
    return {
      ok: false,
      error: `Sonarr didn't confirm the delete. Some files may be gone; the page has been refreshed.${unmonitored}`,
    };
  }

  refresh();
  return { ok: true };
}

import "server-only";
import { SEVERITY_RANK } from "@/components/library/severity";
import { fetchEpisodeQueue, fetchMovieQueue } from "./queue";
import type { components as RadarrComponents } from "./generated/radarr";
import type { components as SonarrComponents } from "./generated/sonarr";

type RadarrQueueResource = RadarrComponents["schemas"]["QueueResource"];
type SonarrQueueResource = SonarrComponents["schemas"]["QueueResource"];

/**
 * The queue fields that Radarr's and Sonarr's QueueResource share. Both generated types are assignable to
 * this, so the helpers below serve both apps. Typecheck enforces that.
 */
export type QueueItem = Pick<
  RadarrQueueResource,
  | "id"
  | "status"
  | "trackedDownloadStatus"
  | "trackedDownloadState"
  | "statusMessages"
  | "errorMessage"
  | "size"
  | "sizeleft"
  | "estimatedCompletionTime"
  | "downloadId"
  | "title"
>;

export type ActivityState =
  | "queued" | "downloading" | "paused" | "delayed"
  | "importPending" | "importing" | "importBlocked"
  | "failed" | "clientUnavailable" | "unknown";
export type ActivitySeverity = "ok" | "warning" | "error";
/**
 * One queue summary for a movie, series or episode, reduced to what the Activity column shows. The `id` is
 * the movie id, series id or episode id, depending on which list it came from.
 */
export type QueueActivity = {
  id: number;
  state: ActivityState;
  severity: ActivitySeverity;
  /** Whole percent 0–100, or null when the app's sizes are missing or don't make sense. */
  progress: number | null;
  /** Seconds until the app expects the download to finish, measured on the server; null when unknown or past. */
  etaSeconds: number | null;
  /** The app's warning/error text. Always [] unless the caller asked for messages (admins only). */
  messages: string[];
  /** How many distinct downloads sit behind this entry. See downloadKeyOf. */
  count: number;
};

/** At most this many message lines per entry. */
export const MAX_ACTIVITY_MESSAGES = 5;
/** Each message is cut to this many characters, counting the trailing "…" when it is cut. */
export const MAX_ACTIVITY_MESSAGE_CHARS = 300;

function raise(current: ActivitySeverity, floor: ActivitySeverity): ActivitySeverity {
  return SEVERITY_RANK[floor] > SEVERITY_RANK[current] ? floor : current;
}

/** The first matching rule wins: client problems, then import/tracking state, then the plain download status. */
function stateOf(item: QueueItem): ActivityState {
  if (item.status === "downloadClientUnavailable") return "clientUnavailable";
  switch (item.trackedDownloadState) {
    case "importBlocked":
      return "importBlocked";
    case "importPending":
      return "importPending";
    case "importing":
    case "imported":
      return "importing";
    case "failedPending":
    case "failed":
      return "failed";
  }
  switch (item.status) {
    case "failed":
      return "failed";
    case "paused":
      return "paused";
    case "queued":
      return "queued";
    case "delay":
      return "delayed";
    case "completed":
      return "importPending";
    case "downloading":
    case "warning":
      return "downloading";
  }
  return "unknown";
}

function severityOf(item: QueueItem, state: ActivityState): ActivitySeverity {
  let severity: ActivitySeverity =
    item.trackedDownloadStatus === "error" ? "error" : item.trackedDownloadStatus === "warning" ? "warning" : "ok";
  if (state === "failed") severity = raise(severity, "error");
  if (state === "clientUnavailable" || state === "importBlocked" || item.status === "warning") {
    severity = raise(severity, "warning");
  }
  return severity;
}

/**
 * Whole percent downloaded, or null when the sizes are missing or contradict each other. The apps still send
 * `sizeleft`, which the spec marks deprecated, and there is no replacement field, so it is used here.
 */
export function progressOf(item: QueueItem): number | null {
  const size = item.size;
  const left = item.sizeleft;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return null;
  if (typeof left !== "number" || !Number.isFinite(left) || left < 0 || left > size) return null;
  return Math.floor(((size - left) / size) * 100);
}

/** Seconds from `now` until the estimated completion, or null when unknown or already past. */
export function etaOf(item: QueueItem, now: number): number | null {
  if (typeof item.estimatedCompletionTime !== "string") return null;
  const time = Date.parse(item.estimatedCompletionTime);
  if (Number.isNaN(time) || time <= now) return null;
  return Math.round((time - now) / 1000);
}

/**
 * The app's warning and error text: the error message, then each status message's lines. The status
 * message title is left out, because it is usually a release or file name. Trimmed, de-duplicated and capped.
 */
export function messagesOf(item: QueueItem): string[] {
  const raw: unknown[] = [item.errorMessage];
  for (const status of item.statusMessages ?? []) raw.push(...(status.messages ?? []));

  const unique = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) unique.add(text);
  }

  const messages: string[] = [];
  for (const text of unique) {
    if (messages.length === MAX_ACTIVITY_MESSAGES) break;
    const chars = Array.from(text);
    messages.push(
      chars.length > MAX_ACTIVITY_MESSAGE_CHARS
        ? chars.slice(0, MAX_ACTIVITY_MESSAGE_CHARS - 1).join("") + "…"
        : text,
    );
  }
  return messages;
}

/**
 * Identifies one download, so queue items that belong to the same download count once. Sonarr's season pack
 * is the case that matters: one download becomes one queue item per episode, all with the same downloadId
 * (checked against Sonarr v4's QueueService.MapQueue). An item with no downloadId falls back to its title.
 * Without this, a 10-episode pack would show "(+9 more)" on the series row. Prefixes keep the three kinds of
 * key apart. Also used by the Queue merge to group Sonarr rows. Keys are never returned to the browser.
 */
export function downloadKeyOf(item: QueueItem, index: number): string {
  if (typeof item.downloadId === "string" && item.downloadId !== "") return `d:${item.downloadId}`;
  if (typeof item.title === "string" && item.title !== "") return `t:${item.title}`;
  if (typeof item.id === "number") return `i:${item.id}`;
  // Nothing identifies this item, so it counts as its own download.
  return `u:${index}`;
}

/**
 * The worst item in a group: the highest severity wins, and a strictly higher one replaces the current pick, so on a
 * tie the earlier item keeps the slot. `items` must not be empty. Its state and severity come back with the item, so
 * callers don't work them out again. Shared by the Activity column and the Queue page.
 */
export function pickWorst<T extends QueueItem>(
  items: T[],
): { item: T; state: ActivityState; severity: ActivitySeverity } {
  if (items.length === 0) throw new Error("pickWorst needs at least one item");
  const first = items[0];
  const firstState = stateOf(first);
  let best = { item: first, state: firstState, severity: severityOf(first, firstState) };
  for (let index = 1; index < items.length; index++) {
    const item = items[index];
    const state = stateOf(item);
    const severity = severityOf(item, state);
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[best.severity]) best = { item, state, severity };
  }
  return best;
}

/**
 * Pure: reduces an app's queue items to one QueueActivity per key, in order of first appearance. `keyOf`
 * picks the grouping id (movie, series or episode). Items whose key is not a positive integer are skipped.
 * Only the QueueActivity fields are returned, so paths, download ids, client and indexer names, and release
 * titles never leave this module.
 */
export function toActivity<T extends QueueItem>(
  items: T[],
  keyOf: (item: T) => number | null | undefined,
  now: number,
  { includeMessages }: { includeMessages: boolean },
): QueueActivity[] {
  const groups = new Map<number, { items: T[]; downloads: Set<string> }>();

  items.forEach((item, index) => {
    const key = keyOf(item);
    if (typeof key !== "number" || !Number.isInteger(key) || key <= 0) return;
    const download = downloadKeyOf(item, index);
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      group.downloads.add(download);
    } else {
      groups.set(key, { items: [item], downloads: new Set([download]) });
    }
  });

  const activity: QueueActivity[] = [];
  for (const [id, group] of groups) {
    const { item, state, severity } = pickWorst(group.items);
    activity.push({
      id,
      state,
      severity,
      progress: progressOf(item),
      etaSeconds: etaOf(item, now),
      messages: includeMessages ? messagesOf(item) : [],
      count: group.downloads.size,
    });
  }
  return activity;
}

/**
 * Radarr's download queue, reduced to one entry per movie. Admins also get Radarr's warning and error
 * text; requesters get none, because messages can contain server paths.
 */
export async function listMovieActivity({ includeMessages }: { includeMessages: boolean }): Promise<QueueActivity[]> {
  const items = await fetchMovieQueue({ includeMovie: false });
  return toActivity(items, (item) => item.movieId, Date.now(), { includeMessages });
}

/** Sonarr's download queue with series and episode objects left out, as the summaries never use them. */
async function sonarrQueue(seriesId?: number): Promise<SonarrQueueResource[]> {
  return fetchEpisodeQueue({ includeSeries: false, includeEpisode: false, seriesId });
}

/**
 * Sonarr's download queue, reduced to one entry per series. Admins also get Sonarr's warning and error
 * text; requesters get none, because messages can contain server paths.
 */
export async function listSeriesActivity({ includeMessages }: { includeMessages: boolean }): Promise<QueueActivity[]> {
  const items = await sonarrQueue();
  return toActivity(items, (item) => item.seriesId, Date.now(), { includeMessages });
}

/**
 * Sonarr's download queue for one series, reduced to one entry per episode. Items from any other series are
 * dropped here as well, so a wrong filter upstream can't leak another series' activity into the result.
 */
export async function listEpisodeActivity(
  seriesId: number,
  { includeMessages }: { includeMessages: boolean },
): Promise<QueueActivity[]> {
  const items = (await sonarrQueue(seriesId)).filter((item) => item.seriesId === seriesId);
  return toActivity(items, (item) => item.episodeId, Date.now(), { includeMessages });
}

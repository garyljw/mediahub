import "server-only";
import { radarrClient } from "./client";
import { getList } from "./request";
import type { components as RadarrComponents } from "./generated/radarr";

type QueueResource = RadarrComponents["schemas"]["QueueResource"];

export type ActivityState =
  | "queued" | "downloading" | "paused" | "delayed"
  | "importPending" | "importing" | "importBlocked"
  | "failed" | "clientUnavailable" | "unknown";
export type ActivitySeverity = "ok" | "warning" | "error";
/** One movie's queue activity, reduced to what the Activity column shows. */
export type MovieActivity = {
  movieId: number;
  state: ActivityState;
  severity: ActivitySeverity;
  /** Whole percent 0–100, or null when Radarr's sizes are missing or don't make sense. */
  progress: number | null;
  /** Seconds until Radarr expects the download to finish, measured on the server; null when unknown or past. */
  etaSeconds: number | null;
  /** Radarr's warning/error text. Always [] unless the caller asked for messages (admins only). */
  messages: string[];
  /** Queue items for this movie (usually 1). */
  count: number;
};

/** At most this many message lines per movie. */
export const MAX_ACTIVITY_MESSAGES = 5;
/** Each message is cut to this many characters, counting the trailing "…" when it is cut. */
export const MAX_ACTIVITY_MESSAGE_CHARS = 300;

const SEVERITY_RANK: Record<ActivitySeverity, number> = { ok: 0, warning: 1, error: 2 };

function raise(current: ActivitySeverity, floor: ActivitySeverity): ActivitySeverity {
  return SEVERITY_RANK[floor] > SEVERITY_RANK[current] ? floor : current;
}

/** The first matching rule wins: client problems, then import/tracking state, then the plain download status. */
function stateOf(item: QueueResource): ActivityState {
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

function severityOf(item: QueueResource, state: ActivityState): ActivitySeverity {
  let severity: ActivitySeverity =
    item.trackedDownloadStatus === "error" ? "error" : item.trackedDownloadStatus === "warning" ? "warning" : "ok";
  if (state === "failed") severity = raise(severity, "error");
  if (state === "clientUnavailable" || state === "importBlocked" || item.status === "warning") {
    severity = raise(severity, "warning");
  }
  return severity;
}

/**
 * Whole percent downloaded, or null when the sizes are missing or contradict each other. Radarr still
 * sends `sizeleft`, which the spec marks deprecated, and there is no replacement field, so it is used here.
 */
function progressOf(item: QueueResource): number | null {
  const size = item.size;
  const left = item.sizeleft;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return null;
  if (typeof left !== "number" || !Number.isFinite(left) || left < 0 || left > size) return null;
  return Math.floor(((size - left) / size) * 100);
}

/** Seconds from `now` until the estimated completion, or null when unknown or already past. */
function etaOf(item: QueueResource, now: number): number | null {
  if (typeof item.estimatedCompletionTime !== "string") return null;
  const time = Date.parse(item.estimatedCompletionTime);
  if (Number.isNaN(time) || time <= now) return null;
  return Math.round((time - now) / 1000);
}

/**
 * Radarr's warning and error text: the error message, then each status message's lines. The status
 * message title is left out, because it is usually a release or file name. Trimmed, de-duplicated and capped.
 */
function messagesOf(item: QueueResource): string[] {
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

/** The winning item for one movie, with the state and severity worked out once, when it is ranked. */
type Group = {
  count: number;
  winner: QueueResource;
  winnerState: ActivityState;
  winnerSeverity: ActivitySeverity;
  winnerRank: number;
};

/**
 * Pure: reduces Radarr's queue items to one MovieActivity per movie, in order of first appearance.
 * Only the MovieActivity fields are returned, so paths, download ids, client and indexer names,
 * and release titles never leave this module.
 */
export function toMovieActivity(
  items: QueueResource[],
  now: number,
  { includeMessages }: { includeMessages: boolean },
): MovieActivity[] {
  const groups = new Map<number, Group>();

  for (const item of items) {
    const movieId = item.movieId;
    if (typeof movieId !== "number" || !Number.isInteger(movieId) || movieId <= 0) continue;

    const state = stateOf(item);
    const severity = severityOf(item, state);
    const rank = SEVERITY_RANK[severity];
    const group = groups.get(movieId);
    if (!group) {
      groups.set(movieId, { count: 1, winner: item, winnerState: state, winnerSeverity: severity, winnerRank: rank });
    } else {
      group.count += 1;
      // Strictly higher wins, so on a tie the earlier item in Radarr's list keeps the slot.
      if (rank > group.winnerRank) {
        group.winner = item;
        group.winnerState = state;
        group.winnerSeverity = severity;
        group.winnerRank = rank;
      }
    }
  }

  const activity: MovieActivity[] = [];
  for (const [movieId, group] of groups) {
    const { winner } = group;
    activity.push({
      movieId,
      state: group.winnerState,
      severity: group.winnerSeverity,
      progress: progressOf(winner),
      etaSeconds: etaOf(winner, now),
      messages: includeMessages ? messagesOf(winner) : [],
      count: group.count,
    });
  }
  return activity;
}

/**
 * Radarr's download queue, reduced to one entry per movie. Admins also get Radarr's warning and error
 * text; requesters get none, because messages can contain server paths.
 */
export async function listMovieActivity({ includeMessages }: { includeMessages: boolean }): Promise<MovieActivity[]> {
  const client = radarrClient();
  const items = await getList("Radarr queue", (signal) =>
    client.GET("/api/v3/queue/details", { params: { query: { includeMovie: false } }, signal }),
  );
  return toMovieActivity(items, Date.now(), { includeMessages });
}

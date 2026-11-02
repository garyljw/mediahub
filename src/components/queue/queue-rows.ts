// The Queue page's row shape, sort and "last known state" logic. Pure, and safe to import from both the server merge
// and the client view, so it must not import server-only code at runtime (type imports only).
import type { ActivitySeverity, ActivityState } from "@/server/arr/activity";
import { SEVERITY_RANK } from "@/components/library/severity";

/** The download details an admin can expand a row to see. Null for requesters. */
export type QueueRowDetails = {
  releaseTitle: string | null;
  quality: string | null;
  sizeBytes: number | null;
  downloadClient: string | null;
  indexer: string | null;
  protocol: string | null;
};

/**
 * One line of the Queue page. This is the only shape that leaves the server for a queue item: no download ids, no
 * output paths and no upstream URLs. A Sonarr season pack is one row, so `queueId` is the smallest item id in its group.
 */
export type QueueRow = {
  /** Unique within the list: `radarr-${queueId}` or `sonarr-${queueId}`. */
  key: string;
  app: "radarr" | "sonarr";
  /** A Radarr or Sonarr queue item id. For a Sonarr group, the smallest id in the group. */
  queueId: number;
  /**
   * Every valid item id this row stands for, sorted ascending. Radarr: [queueId]. Sonarr: all of a download's item
   * ids. Removal sends one of these (see the Queue remove action), so it is never needed in full by the browser.
   */
  queueIds: number[];
  kind: "movie" | "episodes";
  /** Sonarr only: how many episodes the download holds. Null for a movie. */
  episodeCount: number | null;
  /** The movie title, or the series title. "Unknown movie" or "Unknown series" when the item doesn't include one. */
  title: string;
  /**
   * Movie: its year, or "". One episode: "S01E03 · Episode title". Several episodes in one season: "Season 1 · 10
   * episodes". Several seasons: "10 episodes". Unknown: "".
   */
  detail: string;
  /** `/movies/${id}` or `/tv/${id}` when the id is a positive integer, otherwise null. */
  href: string | null;
  /** MediaHub's own poster route, only when the included resource has a poster. */
  posterSrc: string | null;
  state: ActivityState;
  severity: ActivitySeverity;
  /** Whole percent 0–100, or null when unknown. */
  progress: number | null;
  /** Seconds until the expected finish, or null when unknown or past. */
  etaSeconds: number | null;
  /** The app's warning and error text. [] unless the caller asked for details (admins only). */
  messages: string[];
  /** Download details. Null unless the caller asked for details (admins only). */
  details: QueueRowDetails | null;
};

/** Plain code-point comparison, not localeCompare, so the order is the same on the server and in the browser. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * The Queue order: severity (error first), then ETA ascending with unknown last, then title, then key. Used after the
 * server merge and again after combining rows the client kept from an earlier refresh.
 */
export function compareQueueRows(a: QueueRow, b: QueueRow): number {
  const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (severity !== 0) return severity;
  if (a.etaSeconds !== b.etaSeconds) {
    if (a.etaSeconds === null) return 1;
    if (b.etaSeconds === null) return -1;
    return a.etaSeconds - b.etaSeconds;
  }
  return compareText(a.title, b.title) || compareText(a.key, b.key);
}

/** Which of the two apps' queue requests failed on this fetch. */
export type QueueFailures = { radarr: boolean; sonarr: boolean };

/**
 * The last rows the page got from each app. null means that app has never loaded, so there is nothing to keep. An
 * empty list is a successful load with nothing queued.
 */
export type LastKnownRows = { radarr: QueueRow[] | null; sonarr: QueueRow[] | null };

export const NEVER_LOADED: LastKnownRows = { radarr: null, sonarr: null };

/**
 * Updates the last known rows from a fresh fetch. A side that succeeded replaces its rows (empty when it has none). A
 * side that failed keeps what it had, which may be null.
 */
export function keepLastKnown(previous: LastKnownRows, fresh: QueueRow[], failed: QueueFailures): LastKnownRows {
  return {
    radarr: failed.radarr ? previous.radarr : fresh.filter((row) => row.app === "radarr"),
    sonarr: failed.sonarr ? previous.sonarr : fresh.filter((row) => row.app === "sonarr"),
  };
}

/**
 * The rows to show and the alerts for them. Rows from both apps are combined and sorted, so a kept row sorts with the
 * fresh ones. A failed side that has earlier rows keeps them and gets a "showing the last known state" alert. A failed
 * side that never loaded gets a "couldn't load" alert, and one message covers both when both fail that way.
 */
export function visibleQueue(known: LastKnownRows, failed: QueueFailures): { rows: QueueRow[]; alerts: string[] } {
  const rows = [...(known.radarr ?? []), ...(known.sonarr ?? [])].sort(compareQueueRows);

  const alerts: string[] = [];
  const radarrNever = failed.radarr && known.radarr === null;
  const sonarrNever = failed.sonarr && known.sonarr === null;
  if (radarrNever && sonarrNever) {
    alerts.push("Couldn't load the queue from Radarr or Sonarr.");
  } else {
    if (radarrNever) alerts.push("Couldn't load the queue from Radarr.");
    if (sonarrNever) alerts.push("Couldn't load the queue from Sonarr.");
  }
  if (failed.radarr && known.radarr !== null) {
    alerts.push("Couldn't refresh the queue from Radarr; showing the last known state.");
  }
  if (failed.sonarr && known.sonarr !== null) {
    alerts.push("Couldn't refresh the queue from Sonarr; showing the last known state.");
  }
  return { rows, alerts };
}

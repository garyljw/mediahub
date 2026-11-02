import "server-only";
import { radarrClient } from "./client";
import { ArrRequestError, arrRequest, getList } from "./request";
import { releaseCache, type TakenRelease } from "./release-cache";

/**
 * The release fields this file reads. Radarr's and Sonarr's generated ReleaseResource types both satisfy it, so
 * nothing here is tied to one app. The TV-only fields are optional, so a Radarr release simply doesn't have them.
 */
export type ReleaseLike = {
  guid?: string | null;
  title?: string | null;
  indexerId?: number;
  indexer?: string | null;
  protocol?: "unknown" | "usenet" | "torrent";
  quality?: { quality?: { name?: string | null } };
  customFormats?: { name?: string | null }[] | null;
  customFormatScore?: number;
  size?: number;
  ageHours?: number;
  seeders?: number | null;
  leechers?: number | null;
  languages?: { name?: string | null }[] | null;
  approved?: boolean;
  rejections?: string[] | null;
  downloadAllowed?: boolean;
  fullSeason?: boolean;
  mappedSeasonNumber?: number | null;
  mappedEpisodeNumbers?: number[] | null;
};

/** One release, reduced to what the pick dialog shows. No guid or indexer URL ever reaches the browser. */
export type ReleaseRow = {
  /**
   * The opaque grab token, or null when the app doesn't allow a grab (or doesn't say). With no token there
   * is nothing the browser could send, so the server enforces it, not just the disabled button.
   */
  token: string | null;
  title: string;
  indexer: string | null;
  protocol: "usenet" | "torrent" | "unknown";
  quality: string | null;
  customFormats: string[];
  customFormatScore: number;
  /** Bytes. 0 when missing or invalid. */
  size: number;
  ageHours: number | null;
  /** Torrents only. */
  seeders: number | null;
  /** Torrents only. */
  leechers: number | null;
  languages: string[];
  /** True when the app would grab the release on its own. */
  approved: boolean;
  /** Why the app wouldn't grab it. Capped at MAX_REJECTIONS. */
  rejections: string[];
  /** TV only: "Season pack", "S02E05" or "S02E05-E06". Null for movies and for releases Sonarr hasn't mapped. */
  episodes: string | null;
};

/**
 * Most releases returned per protocol for one search. The app can return hundreds; the dialog only needs the
 * best ones. The cap is per protocol, so filtering the dialog to torrents (or Usenet) still shows the best
 * torrents even when the app ranks hundreds of Usenet releases above them.
 */
export const MAX_RELEASES_PER_PROTOCOL = 200;

/** How many usable releases the app found: all of them, and per protocol. Unknown-protocol releases count only in `all`. */
export type ReleaseTotals = { all: number; usenet: number; torrent: number };
/** Longest title sent to the browser, in code points. Longer titles are cut and end with an ellipsis. */
const MAX_TITLE = 300;
/** Most rejection reasons shown per release. */
const MAX_REJECTIONS = 10;

/** The app waits on every indexer before it answers an interactive search. */
export const RELEASE_SEARCH_TIMEOUT_MS = 90_000;
/** The app fetches the file from the indexer and hands it to the download client before it answers. */
export const RELEASE_GRAB_TIMEOUT_MS = 60_000;

/**
 * Why a grab can't go ahead: "expired" when the token is unknown, already used or past its lifetime (the app
 * is not asked), or when the app answers 404. For Radarr a 404 means it no longer has the release. Sonarr also
 * answers 404 when it can't match the release to episodes. Mapped to a message in the action.
 */
export class ReleaseGrabError extends Error {
  constructor(readonly reason: "expired") {
    super("release expired");
    this.name = "ReleaseGrabError";
  }
}

/** The text as the app sent it, or null when it is missing or blank. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A finite number, or null. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Names from a list of { name }, skipping any without a usable name. */
function names(items: { name?: string | null }[] | null | undefined): string[] {
  const result: string[] = [];
  for (const item of items ?? []) {
    const name = text(item.name);
    if (name !== null) result.push(name);
  }
  return result;
}

function protocolOf(value: unknown): ReleaseRow["protocol"] {
  if (value === "usenet" || value === "torrent") return value;
  return "unknown";
}

/** At least two digits: 5 → "05", 105 → "105". Same rule as episodeCode in src/components/library/release.ts. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** A whole number at least `min`, or null. */
function wholeAtLeast(value: unknown, min: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min ? value : null;
}

/**
 * Pure: the "episodes" label for a TV release, or null. "Season pack" for a full-season release. Otherwise
 * "S02E05", "S02E05-E06" for consecutive episodes or "S02E01, E03" otherwise, from Sonarr's mapped season and
 * episode numbers, sorted and without duplicates. Null when the season
 * isn't a whole number, when there are no episode numbers, or when any episode number isn't a positive whole
 * number: a label is only shown when the whole mapping is usable.
 */
export function episodesLabel(release: Pick<ReleaseLike, "fullSeason" | "mappedSeasonNumber" | "mappedEpisodeNumbers">): string | null {
  if (release.fullSeason === true) return "Season pack";
  const season = wholeAtLeast(release.mappedSeasonNumber, 0);
  const numbers = release.mappedEpisodeNumbers ?? [];
  if (season === null || numbers.length === 0) return null;
  const checked = numbers.map((n) => wholeAtLeast(n, 1));
  if (checked.some((n) => n === null)) return null;
  const episodes = [...new Set(checked as number[])].sort((a, b) => a - b);
  const first = episodes[0];
  const last = episodes[episodes.length - 1];
  const code = `S${pad2(season)}E${pad2(first)}`;
  if (first === last) return code;
  // Sorted with no duplicates, so the list is consecutive exactly when it spans its own length.
  if (last - first === episodes.length - 1) return `${code}-E${pad2(last)}`;
  return [code, ...episodes.slice(1).map((n) => `E${pad2(n)}`)].join(", ");
}

/**
 * Pure: maps the app's releases to dialog rows, in upstream order. The app returns them best-first by its own
 * ranking, and that order is kept. Skips a release without a guid, without a positive indexer id, or without a
 * title. `totals` counts every usable release, and `rows` holds the first MAX_RELEASES_PER_PROTOCOL of each
 * protocol (unknown is its own group), still in the app's order.
 * `makeToken` runs only for returned rows that the app allows to be grabbed.
 */
export function toReleaseRows(
  releases: ReleaseLike[],
  makeToken: (key: { guid: string; indexerId: number; title: string }) => string,
): { rows: ReleaseRow[]; totals: ReleaseTotals } {
  const rows: ReleaseRow[] = [];
  const totals: ReleaseTotals = { all: 0, usenet: 0, torrent: 0 };
  const kept: Record<ReleaseRow["protocol"], number> = { usenet: 0, torrent: 0, unknown: 0 };

  for (const release of releases) {
    const guid = text(release.guid);
    const title = text(release.title);
    const indexerId = release.indexerId;
    if (guid === null || title === null || typeof indexerId !== "number" || !Number.isInteger(indexerId) || indexerId <= 0) {
      continue;
    }
    const protocol = protocolOf(release.protocol);
    totals.all += 1;
    if (protocol !== "unknown") totals[protocol] += 1;
    if (kept[protocol] >= MAX_RELEASES_PER_PROTOCOL) continue;
    kept[protocol] += 1;

    // Array.from splits by code point, so the cut never splits a surrogate pair.
    const titleChars = Array.from(title);
    const shortTitle = titleChars.length > MAX_TITLE ? `${titleChars.slice(0, MAX_TITLE - 1).join("")}…` : title;
    const rejections: string[] = [];
    for (const reason of release.rejections ?? []) {
      const clean = text(reason);
      if (clean !== null) rejections.push(clean);
      if (rejections.length >= MAX_REJECTIONS) break;
    }
    const size = finiteOrNull(release.size);
    const ageHours = finiteOrNull(release.ageHours);

    rows.push({
      // The cached title is the shortened one, so a grab never returns more text than the row showed.
      token: release.downloadAllowed === true ? makeToken({ guid, indexerId, title: shortTitle }) : null,
      title: shortTitle,
      indexer: text(release.indexer),
      protocol,
      quality: text(release.quality?.quality?.name),
      customFormats: names(release.customFormats),
      customFormatScore: finiteOrNull(release.customFormatScore) ?? 0,
      size: size !== null && size > 0 ? size : 0,
      ageHours: ageHours !== null && ageHours >= 0 ? ageHours : null,
      seeders: protocol === "torrent" ? finiteOrNull(release.seeders) : null,
      leechers: protocol === "torrent" ? finiteOrNull(release.leechers) : null,
      languages: names(release.languages),
      approved: release.approved === true,
      rejections,
      episodes: episodesLabel(release),
    });
  }

  return { rows, totals };
}

/**
 * Asks Radarr for interactive search results for one movie. Radarr queries every indexer, so this is slow.
 * Each returned release gets a server-side token, and the grab action accepts only those tokens.
 */
export async function searchReleases(movieId: number): Promise<{ rows: ReleaseRow[]; totals: ReleaseTotals }> {
  const client = radarrClient();
  const releases = await getList(
    "Radarr release search",
    (signal) => client.GET("/api/v3/release", { params: { query: { movieId } }, signal }),
    { timeoutMs: RELEASE_SEARCH_TIMEOUT_MS },
  );
  return toReleaseRows(releases, (key) => releaseCache.put({ app: "radarr", ...key }));
}

/**
 * True when the app answered a grab with a refusal (a 4xx), so nothing was grabbed and a retry is safe. A 5xx,
 * timeout, network error or unreadable reply may come after the release reached the download client. The
 * grab actions use this too, so the token rule and the message the admin sees always agree.
 */
export function grabWasRefused(error: ArrRequestError): boolean {
  return error.kind === "http" && error.status !== undefined && error.status >= 400 && error.status < 500;
}

/**
 * Applies the token rule to a grab that failed, then rethrows. Only a refusal (a 4xx) restores the token for a
 * retry. A 404 means the app no longer has the release, so a retry would fail the same way: that throws "expired"
 * and doesn't restore. Anything else may mean the release already reached the download client, so it isn't restored.
 * Shared by the Radarr and Sonarr grabs.
 */
export function failGrab(error: unknown, taken: Pick<TakenRelease, "restore">): never {
  if (error instanceof ArrRequestError && grabWasRefused(error)) {
    // 404: the app no longer has this release, so a retry would fail the same way. Don't restore it.
    if (error.status === 404) throw new ReleaseGrabError("expired");
    // Any other refusal (409 means the indexer wouldn't hand the file over) grabbed nothing, so allow a retry.
    taken.restore();
  }
  // Anything else may mean the release already reached the download client. Don't restore: a retry could
  // grab it twice.
  throw error;
}

/**
 * Sends one release, found by an earlier search, to Radarr's download client. The browser sends only the
 * token. The guid and indexer id come from the server's cache, and the body sent to Radarr has nothing else.
 */
export async function grabRelease(token: string): Promise<{ title: string }> {
  // Build the client first, so a config error does not use up the token.
  const client = radarrClient();
  const taken = releaseCache.take(token, "radarr");
  if (!taken) throw new ReleaseGrabError("expired");
  const { release } = taken;

  const body = { guid: release.guid, indexerId: release.indexerId };
  try {
    await arrRequest("Radarr release grab", (signal) => client.POST("/api/v3/release", { body, signal }), {
      timeoutMs: RELEASE_GRAB_TIMEOUT_MS,
    });
  } catch (error) {
    failGrab(error, taken);
  }

  return { title: release.title };
}

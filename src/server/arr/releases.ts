import "server-only";
import { radarrClient } from "./client";
import { ArrRequestError, arrRequest, getList } from "./request";
import { releaseCache } from "./release-cache";
import type { components as RadarrComponents } from "./generated/radarr";

type ReleaseResource = RadarrComponents["schemas"]["ReleaseResource"];

/** One release, reduced to what the pick dialog shows. No guid or indexer URL ever reaches the browser. */
export type ReleaseRow = {
  /**
   * The opaque grab token, or null when Radarr doesn't allow a grab (or doesn't say). With no token there
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
  /** True when Radarr would grab the release on its own. */
  approved: boolean;
  /** Why Radarr wouldn't grab it. Capped at MAX_REJECTIONS. */
  rejections: string[];
};

/**
 * Most releases returned per protocol for one search. Radarr can return hundreds; the dialog only needs the
 * best ones. The cap is per protocol, so filtering the dialog to torrents (or Usenet) still shows the best
 * torrents even when Radarr ranks hundreds of Usenet releases above them.
 */
export const MAX_RELEASES_PER_PROTOCOL = 200;

/** How many usable releases Radarr found: all of them, and per protocol. Unknown-protocol releases count only in `all`. */
export type ReleaseTotals = { all: number; usenet: number; torrent: number };
/** Longest title sent to the browser, in code points. Longer titles are cut and end with an ellipsis. */
const MAX_TITLE = 300;
/** Most rejection reasons shown per release. */
const MAX_REJECTIONS = 10;

/** Radarr waits on every indexer before it answers an interactive search. */
export const RELEASE_SEARCH_TIMEOUT_MS = 90_000;
/** Radarr fetches the file from the indexer and hands it to the download client before it answers. */
export const RELEASE_GRAB_TIMEOUT_MS = 60_000;

/**
 * Why a grab can't go ahead: "expired" when the token is unknown, already used or past its lifetime (Radarr
 * is not asked), or when Radarr answers 404 because it no longer has the release. Mapped to a message in the action.
 */
export class ReleaseGrabError extends Error {
  constructor(readonly reason: "expired") {
    super("release expired");
    this.name = "ReleaseGrabError";
  }
}

/** The text as Radarr sent it, or null when it is missing or blank. */
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

/**
 * Pure: maps Radarr's releases to dialog rows, in upstream order. Radarr returns them best-first by its
 * own ranking, and that order is kept. Skips a release without a guid, without a positive indexer id, or
 * without a title. `totals` counts every usable release, and `rows` holds the first MAX_RELEASES_PER_PROTOCOL
 * of each protocol (unknown is its own group), still in Radarr's order.
 * `makeToken` runs only for returned rows that Radarr allows to be grabbed.
 */
export function toReleaseRows(
  releases: ReleaseResource[],
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
  return toReleaseRows(releases, (key) => releaseCache.put(key));
}

/**
 * True when Radarr answered a grab with a refusal (a 4xx), so nothing was grabbed and a retry is safe. A 5xx,
 * timeout, network error or unreadable reply may come after the release reached the download client. The
 * grab action uses this too, so the token rule and the message the admin sees always agree.
 */
export function grabWasRefused(error: ArrRequestError): boolean {
  return error.kind === "http" && error.status !== undefined && error.status >= 400 && error.status < 500;
}

/**
 * Sends one release, found by an earlier search, to Radarr's download client. The browser sends only the
 * token. The guid and indexer id come from the server's cache, and the body sent to Radarr has nothing else.
 */
export async function grabRelease(token: string): Promise<{ title: string }> {
  // Build the client first, so a config error does not use up the token.
  const client = radarrClient();
  const taken = releaseCache.take(token);
  if (!taken) throw new ReleaseGrabError("expired");
  const { release } = taken;

  const body = { guid: release.guid, indexerId: release.indexerId };
  try {
    await arrRequest("Radarr release grab", (signal) => client.POST("/api/v3/release", { body, signal }), {
      timeoutMs: RELEASE_GRAB_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof ArrRequestError && grabWasRefused(error)) {
      // 404: Radarr no longer has this release, so a retry would fail the same way. Don't restore it.
      if (error.status === 404) throw new ReleaseGrabError("expired");
      // Any other refusal (409 means the indexer wouldn't hand the file over) grabbed nothing, so allow a retry.
      taken.restore();
    }
    // Anything else may mean the release already reached the download client. Don't restore: a retry could
    // grab it twice.
    throw error;
  }

  return { title: release.title };
}

import "server-only";
import { sonarrClient } from "./client";
import { arrRequest, getList } from "./request";
import { releaseCache, type SonarrContext } from "./release-cache";
import {
  RELEASE_GRAB_TIMEOUT_MS,
  RELEASE_SEARCH_TIMEOUT_MS,
  ReleaseGrabError,
  failGrab,
  toReleaseRows,
  type ReleaseRow,
  type ReleaseTotals,
} from "./releases";

/**
 * What one Sonarr search is for: one episode, or one season of a series. Sonarr only filters its release search
 * when it gets episodeId, or seriesId with seasonNumber. A seriesId alone is not a valid target, so the type has no
 * such shape.
 */
export type SeriesReleaseTarget = { episodeId: number } | { seriesId: number; seasonNumber: number };

/**
 * Asks Sonarr for interactive search results for one episode or one season. Sonarr queries every indexer, so this
 * is slow. Each returned release gets a server-side token, and the grab action accepts only those tokens.
 */
export async function searchSeriesReleases(target: SeriesReleaseTarget): Promise<{ rows: ReleaseRow[]; totals: ReleaseTotals }> {
  const client = sonarrClient();
  const query =
    "episodeId" in target
      ? { episodeId: target.episodeId }
      : { seriesId: target.seriesId, seasonNumber: target.seasonNumber };
  // An episode grab sends only the episode id, so Sonarr finds the series from the episode itself and a series id
  // can never disagree with it.
  const context: SonarrContext = "episodeId" in target ? { episodeId: target.episodeId } : { seriesId: target.seriesId };
  const releases = await getList(
    "Sonarr release search",
    (signal) => client.GET("/api/v3/release", { params: { query }, signal }),
    { timeoutMs: RELEASE_SEARCH_TIMEOUT_MS },
  );
  return toReleaseRows(releases, (key) => releaseCache.put({ app: "sonarr", ...key, context }));
}

/**
 * Sends one release, found by an earlier search, to Sonarr's download client. The browser sends only the token.
 * The guid, indexer id and the series or episode id come from the server's cache, and the body sent to Sonarr has
 * nothing else.
 */
export async function grabSeriesRelease(token: string): Promise<{ title: string }> {
  // Build the client first, so a config error does not use up the token.
  const client = sonarrClient();
  const taken = releaseCache.take(token, "sonarr");
  if (!taken) throw new ReleaseGrabError("expired");
  const { release } = taken;
  const body = { guid: release.guid, indexerId: release.indexerId, ...release.context };
  try {
    await arrRequest("Sonarr release grab", (signal) => client.POST("/api/v3/release", { body, signal }), {
      timeoutMs: RELEASE_GRAB_TIMEOUT_MS,
    });
  } catch (error) {
    failGrab(error, taken);
  }

  return { title: release.title };
}

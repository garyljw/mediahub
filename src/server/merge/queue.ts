import "server-only";
import type { components as RadarrComponents } from "../arr/generated/radarr";
import type { components as SonarrComponents } from "../arr/generated/sonarr";
import { downloadKeyOf, etaOf, messagesOf, pickWorst, progressOf, type QueueItem } from "../arr/activity";
import { episodeCode } from "@/components/library/release";
import { compareQueueRows, type QueueRow, type QueueRowDetails } from "@/components/queue/queue-rows";
import { hasPoster } from "./images";
import { canManualImport } from "./manual-import";
import { toPeek } from "./peek";

export type { QueueRow, QueueRowDetails };

type MovieQueueItem = RadarrComponents["schemas"]["QueueResource"];
type EpisodeQueueItem = SonarrComponents["schemas"]["QueueResource"];

/** A positive integer id, or null. */
function validId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** A non-negative integer, or null. Used for season and episode numbers (season 0 is specials). */
function countOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** The progress, ETA, messages and details of one item. Shared by movie and episode rows. */
type Facts = Pick<QueueRow, "state" | "severity" | "progress" | "etaSeconds" | "messages" | "details">;

function factsOf(
  item: QueueItem,
  state: QueueRow["state"],
  severity: QueueRow["severity"],
  now: number,
  includeDetails: boolean,
): Facts {
  return {
    state,
    severity,
    progress: progressOf(item),
    etaSeconds: etaOf(item, now),
    messages: includeDetails ? messagesOf(item) : [],
    details: includeDetails ? detailsOf(item) : null,
  };
}

/** Release and client facts for an admin. Never includes download ids or output paths. */
function detailsOf(item: MovieQueueItem | EpisodeQueueItem): QueueRowDetails {
  const size = item.size;
  return {
    releaseTitle: nonEmpty(item.title),
    quality: nonEmpty(item.quality?.quality?.name),
    sizeBytes: typeof size === "number" && Number.isFinite(size) && size > 0 ? size : null,
    downloadClient: nonEmpty(item.downloadClient),
    indexer: nonEmpty(item.indexer),
    protocol: nonEmpty(item.protocol),
  };
}

/** One episode in a Sonarr row, with the fields the detail text needs. */
type EpisodeRef = { id: number; season: number | null; number: number | null; title: string | null };

/** The text under a Sonarr row's title. See QueueRow.detail for the rules. */
function episodeDetail(episodes: EpisodeRef[]): string {
  if (episodes.length === 0) return "";
  if (episodes.length === 1) {
    const [episode] = episodes;
    if (episode.season === null || episode.number === null) return "";
    return `${episodeCode(episode.season, episode.number)} · ${episode.title ?? "TBA"}`;
  }
  const count = `${episodes.length} episodes`;
  const seasons = new Set(episodes.map((episode) => episode.season));
  if (seasons.size === 1 && episodes[0].season !== null) return `Season ${episodes[0].season} · ${count}`;
  return count;
}

/** Null seasons and numbers sort last. */
function byNullLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** The distinct episodes across a group, sorted by season then episode number. */
function episodesOf(items: EpisodeQueueItem[]): EpisodeRef[] {
  const byId = new Map<number, EpisodeRef>();
  for (const item of items) {
    const id = validId(item.episodeId) ?? validId(item.episode?.id);
    if (id === null || byId.has(id)) continue;
    byId.set(id, {
      id,
      season: countOrNull(item.episode?.seasonNumber ?? item.seasonNumber),
      number: countOrNull(item.episode?.episodeNumber),
      title: nonEmpty(item.episode?.title),
    });
  }
  return [...byId.values()].sort(
    (a, b) => byNullLast(a.season, b.season) || byNullLast(a.number, b.number) || a.id - b.id,
  );
}

/** One Sonarr download: the valid, unique ids of its items (sorted), its row id, and the items themselves. */
type EpisodeGroup = { queueId: number; ids: number[]; items: EpisodeQueueItem[] };

/**
 * Pure: groups Sonarr's queue items by download (downloadKeyOf, within one series), so a season pack's per-episode
 * items form one group. Items whose id isn't a positive integer are skipped, and so is any repeat of an id already
 * seen. A group's queueId is its smallest id. The one grouping, used by toQueueRows.
 */
function groupEpisodeItems(episodeItems: EpisodeQueueItem[]): EpisodeGroup[] {
  const groups = new Map<string, EpisodeQueueItem[]>();
  const seenEpisode = new Set<number>();
  episodeItems.forEach((item, index) => {
    const id = validId(item.id);
    if (id === null || seenEpisode.has(id)) return;
    seenEpisode.add(id);
    // Series id is part of the key, so two series can never share a group even if their fallback download keys match.
    const seriesId = validId(item.seriesId) ?? validId(item.series?.id);
    const groupKey = `${seriesId ?? "none"}\u0000${downloadKeyOf(item, index)}`;
    const group = groups.get(groupKey);
    if (group) group.push(item);
    else groups.set(groupKey, [item]);
  });

  return [...groups.values()].map((items) => {
    // Every item here has a valid id (checked when grouped), so sorting the ids gives the smallest first.
    const ids = items.map((item) => validId(item.id)).filter((id): id is number => id !== null).sort((a, b) => a - b);
    return { queueId: ids[0], ids, items };
  });
}

/**
 * Pure: the first id in `ids` (in the order given) that is the id of an item in `items`, or null when none of them is.
 * `items` is one app's queue, so only that app's ids are checked. Ids that aren't positive integers never match.
 */
export function firstQueuedId(items: readonly { id?: number | null }[], ids: readonly number[]): number | null {
  const queued = new Set<number>();
  for (const item of items) {
    const id = validId(item.id);
    if (id !== null) queued.add(id);
  }
  return ids.find((id) => queued.has(id)) ?? null;
}

/**
 * Pure: builds the Queue rows from Radarr's queue (one row per item) and Sonarr's queue (one row per download, so a
 * season pack's per-episode items become one row). Items whose id isn't a positive integer are skipped, and so is any
 * repeat of an id already seen. A Sonarr row's state, severity, progress and ETA come from its worst item (see
 * pickWorst). Its key uses the smallest item id in the group, so the key doesn't depend on the order the app lists
 * items in. It does change if that item leaves the queue before the rest. With `includeDetails` false (requesters),
 * messages, details and canForceImport are left out. Sorted by compareQueueRows.
 */
export function toQueueRows(
  movieItems: MovieQueueItem[],
  episodeItems: EpisodeQueueItem[],
  now: number,
  { includeDetails }: { includeDetails: boolean },
): QueueRow[] {
  const rows: QueueRow[] = [];

  const seenMovie = new Set<number>();
  for (const item of movieItems) {
    const id = validId(item.id);
    if (id === null || seenMovie.has(id)) continue;
    seenMovie.add(id);
    const movieId = validId(item.movieId);
    const movie = item.movie;
    const { state, severity } = pickWorst([item]);
    const year = countOrNull(movie?.year);
    rows.push({
      key: `radarr-${id}`,
      app: "radarr",
      queueId: id,
      queueIds: includeDetails ? [id] : [],
      kind: "movie",
      title: nonEmpty(movie?.title) ?? "Unknown movie",
      detail: year !== null && year > 0 ? String(year) : "",
      href: movieId !== null ? `/movies/${movieId}` : null,
      posterSrc: movieId !== null && hasPoster(movie?.images) ? `/api/movies/${movieId}/poster` : null,
      peek: toPeek(movie),
      ...factsOf(item, state, severity, now, includeDetails),
      canForceImport: includeDetails && canManualImport(item),
    });
  }

  for (const group of groupEpisodeItems(episodeItems)) {
    const { item: winner, state, severity } = pickWorst(group.items);
    const seriesId = group.items.map((item) => validId(item.seriesId) ?? validId(item.series?.id)).find((id) => id !== null) ?? null;
    const seriesSource = group.items.find((item) => nonEmpty(item.series?.title) !== null) ?? group.items[0];
    const episodes = episodesOf(group.items);
    rows.push({
      key: `sonarr-${group.queueId}`,
      app: "sonarr",
      queueId: group.queueId,
      queueIds: includeDetails ? group.ids : [],
      kind: "episodes",
      title: nonEmpty(seriesSource.series?.title) ?? "Unknown series",
      detail: episodeDetail(episodes),
      href: seriesId !== null ? `/tv/${seriesId}` : null,
      posterSrc: seriesId !== null && hasPoster(seriesSource.series?.images) ? `/api/tv/${seriesId}/poster` : null,
      peek: toPeek(seriesSource.series),
      ...factsOf(winner, state, severity, now, includeDetails),
      canForceImport: includeDetails && group.items.some(canManualImport),
    });
  }

  return rows.sort(compareQueueRows);
}

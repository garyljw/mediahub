import "server-only";
import type { PlexEpisodeAdded, PlexSectionItem } from "@/server/plex/server";
import { idsFromGuids, TMDB_GUID, TVDB_GUID } from "./watched";

// Pure: when each movie and series arrived in Plex, from the library items' addedAt and the episodes' addedAt. No I/O.

/** When a title arrived in Plex, as an ISO string, by TMDB id (movies) and TVDB id (series). */
export type PlexAddedIndex = { movies: Map<number, string>; series: Map<number, string> };

/**
 * Pure: builds the Plex added index. A movie's date is its own addedAt. A show's date is the newest addedAt among its
 * episodes (its own addedAt is when the show first appeared, which says nothing about newer episodes). Items are keyed
 * by their guids, and an item with no matching guid is skipped. When an id appears more than once, the newest date is
 * kept. Plex sends seconds, and the index holds ISO strings.
 */
export function toPlexAddedIndex(
  movieItems: PlexSectionItem[],
  showItems: PlexSectionItem[],
  episodes: PlexEpisodeAdded[],
): PlexAddedIndex {
  const movies = new Map<number, number>();
  const series = new Map<number, number>();
  const keepNewest = (map: Map<number, number>, id: number, seconds: number) => {
    const existing = map.get(id);
    if (existing === undefined || seconds > existing) map.set(id, seconds);
  };

  for (const item of movieItems) {
    if (item.addedAt === null) continue;
    for (const tmdbId of idsFromGuids(item.guids, TMDB_GUID)) keepNewest(movies, tmdbId, item.addedAt);
  }

  const newestEpisodeByShow = new Map<string, number>();
  for (const episode of episodes) {
    const existing = newestEpisodeByShow.get(episode.showKey);
    if (existing === undefined || episode.addedAt > existing) newestEpisodeByShow.set(episode.showKey, episode.addedAt);
  }
  for (const item of showItems) {
    if (item.ratingKey === null) continue;
    const seconds = newestEpisodeByShow.get(item.ratingKey);
    if (seconds === undefined) continue;
    for (const tvdbId of idsFromGuids(item.guids, TVDB_GUID)) keepNewest(series, tvdbId, seconds);
  }

  return { movies: toIso(movies), series: toIso(series) };
}

function toIso(seconds: Map<number, number>): Map<number, string> {
  return new Map([...seconds].map(([id, value]) => [id, new Date(value * 1000).toISOString()]));
}

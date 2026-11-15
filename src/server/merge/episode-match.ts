import "server-only";

/**
 * Whether TMDB's episode is the one Sonarr means. False only when both TVDB ids are known and differ, which is TMDB
 * numbering the episode differently. When either is unknown it is true: the numbering usually matches, and a new
 * episode often has no TVDB id yet.
 */
export function sameEpisode(sonarrTvdbId: number | null, tmdbTvdbId: number | null): boolean {
  return sonarrTvdbId === null || tmdbTvdbId === null || sonarrTvdbId === tmdbTvdbId;
}

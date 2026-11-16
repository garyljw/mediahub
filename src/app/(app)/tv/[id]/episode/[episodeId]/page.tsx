import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { WatchedBadge } from "@/components/tv/watched-badge";
import { Breadcrumb } from "@/components/breadcrumb/breadcrumb";
import { formatAdded, formatSize } from "@/components/library/format";
import { metaLine } from "@/components/library/detail-format";
import { CastRow } from "@/components/library/cast-row";
import { ItemPageLayout } from "@/components/library/item-page";
import { episodeCode } from "@/components/library/release";
import { EPISODE_STATUS_CLASS, EPISODE_STATUS_LABEL } from "@/components/tv/series-status";
import { EpisodeHeaderActions } from "@/components/tv/episode-header-actions";
import { EpisodeHeroActivity, SeriesActivityProvider } from "@/components/tv/series-activity";
import { requirePageUser } from "@/server/authz";
import { ArrRequestError } from "@/server/arr/request";
import { findEpisode, getSeriesDetail, type SeriesDetailPage } from "@/server/arr/series-detail";
import { sameEpisode } from "@/server/merge/episode-match";
import { episodeWatchedFor } from "@/server/plex/episode-watched";
import { getTmdbConfig } from "@/server/settings/tmdb";
import { getEpisodeCredits, getEpisodeTvdbId, TmdbRequestError } from "@/server/tmdb/client";
import { isTmdbNotFound } from "@/server/tmdb/errors";

export const metadata = { title: "TV" };
// The page waits for Sonarr and Plex before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

// Plain digits only, and a positive id. Anything else is not a series or episode, so it gets the not-found page.
const idParam = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
  .refine((n) => n > 0);

/**
 * The Cast section from TMDB, loaded on its own so the page doesn't wait for TMDB. Nothing when there is no TMDB
 * token, Sonarr has no TMDB id, TMDB doesn't know the episode, or TMDB numbers it differently from Sonarr (its TVDB
 * id for the episode differs from Sonarr's, so the cast would be another episode's). Any other TMDB failure becomes a message in the
 * section; a non-TMDB error is rethrown.
 */
async function EpisodeCast({
  tmdbId,
  seasonNumber,
  episodeNumber,
  tvdbId,
}: {
  tmdbId: number | null;
  seasonNumber: number;
  episodeNumber: number;
  /** Sonarr's TVDB id for the episode, or null. */
  tvdbId: number | null;
}) {
  const config = getTmdbConfig();
  if (config === null || tmdbId === null) return null;
  let cast: Awaited<ReturnType<typeof getEpisodeCredits>>;
  let tmdbTvdbId: number | null;
  try {
    [cast, tmdbTvdbId] = await Promise.all([
      getEpisodeCredits(config.token, tmdbId, seasonNumber, episodeNumber),
      getEpisodeTvdbId(config.token, tmdbId, seasonNumber, episodeNumber),
    ]);
  } catch (error) {
    if (isTmdbNotFound(error)) return null;
    if (!(error instanceof TmdbRequestError)) throw error;
    // TmdbRequestError messages never contain the host, token or response body, so they are safe to log.
    console.error(`Episode page: ${error.message}`);
    return <CastRow members={[]} linkPeople={false} error="Couldn't load the cast from TMDB." />;
  }
  if (!sameEpisode(tvdbId, tmdbTvdbId)) return null;
  return (
    <CastRow
      linkPeople
      members={cast.map((member) => ({
        key: member.id,
        personId: member.id,
        name: member.name,
        character: member.character,
        episodes: member.episodes,
        photo: member.photo,
      }))}
    />
  );
}

export default async function EpisodePage({ params }: { params: Promise<{ id: string; episodeId: string }> }) {
  const user = await requirePageUser("admin", "requester");
  const isAdmin = user.role === "admin";

  const { id, episodeId } = await params;
  const parsedSeries = idParam.safeParse(id);
  const parsedEpisode = idParam.safeParse(episodeId);
  if (!parsedSeries.success || !parsedEpisode.success) notFound();

  let page: SeriesDetailPage | null;
  try {
    page = await getSeriesDetail(parsedSeries.data);
  } catch (error) {
    // Anything that isn't a Sonarr request failure (a config error, a bug) goes to Next's error handling.
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Episode page: ${error.message}`);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">TV</h1>
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load this episode from Sonarr.
        </p>
      </div>
    );
  }

  if (page === null) notFound();
  const { detail } = page;
  const found = findEpisode(detail, parsedEpisode.data);
  if (found === null) notFound();
  const { season, episode } = found;
  const code = episodeCode(season.seasonNumber, episode.episodeNumber);
  const watched = await episodeWatchedFor(detail);
  // The series' own links: the IDs were checked when the detail was mapped, so building the links from them is safe.
  const imdbUrl = detail.imdbId === null ? null : `https://www.imdb.com/title/${detail.imdbId}/`;
  const tvdbUrl = detail.tvdbId === null ? null : `https://www.thetvdb.com/?tab=series&id=${detail.tvdbId}`;
  const tmdbUrl = detail.tmdbId === null ? null : `https://www.themoviedb.org/tv/${detail.tmdbId}`;

  return (
    <SeriesActivityProvider key={detail.id} seriesId={detail.id}>
      <ItemPageLayout
        breadcrumb={<Breadcrumb label={`${detail.title} · ${code}`} parents={[{ path: `/tv/${detail.id}`, label: detail.title }]} />}
        title={episode.title}
        year={null}
        meta={metaLine({
          certification: detail.certification,
          runtime: episode.runtime ?? detail.runtime,
          genres: detail.genres,
        })}
        extraLines={[`${detail.title} · ${season.label}, episode ${episode.episodeNumber}`]}
        backdropSrc={detail.hasBackdrop ? `/api/tv/${detail.id}/backdrop` : null}
        posterSrc={detail.hasPoster ? `/api/tv/${detail.id}/poster` : null}
        arr={{
          status: { label: EPISODE_STATUS_LABEL[episode.status], className: EPISODE_STATUS_CLASS[episode.status] },
          monitored: episode.monitored,
          qualityProfile: detail.qualityProfile,
        }}
        overview={episode.overview}
        actions={
          <EpisodeHeaderActions
            seriesId={detail.id}
            seriesTitle={detail.title}
            seasonNumber={season.seasonNumber}
            episodeId={episode.id}
            episodeNumber={episode.episodeNumber}
            monitored={episode.monitored}
            hasFile={episode.hasFile}
            isAdmin={isAdmin}
          />
        }
        activity={<EpisodeHeroActivity episodeId={episode.id} name={code} />}
        typeSection={
          <Suspense fallback={null}>
            <EpisodeCast
              tmdbId={detail.tmdbId}
              seasonNumber={season.seasonNumber}
              episodeNumber={episode.episodeNumber}
              tvdbId={episode.tvdbId}
            />
          </Suspense>
        }
        facts={[
          {
            label: "Series",
            value: (
              <Link href={`/tv/${detail.id}`} className="hover:underline">
                {detail.title}
              </Link>
            ),
          },
          { label: "Season", value: season.label },
          { label: "Episode", value: code },
          { label: "Air date", value: formatAdded(episode.airDate) },
          ...(watched === null
            ? []
            : [
                {
                  label: "Watched",
                  value:
                    watched === "failed" ? (
                      <span className="text-muted-foreground">Couldn&apos;t load from Plex</span>
                    ) : (
                      <WatchedBadge state={watched.get(episode.id)} />
                    ),
                },
              ]),
          { label: "File quality", value: episode.quality ?? "—" },
          { label: "Size", value: formatSize(episode.size) },
          { label: "Network", value: detail.network ?? "—" },
        ]}
        links={[
          { label: "IMDb", url: imdbUrl },
          { label: "TVDB", url: tvdbUrl },
          { label: "TMDB", url: tmdbUrl },
        ]}
        settings={null}
      />
    </SeriesActivityProvider>
  );
}

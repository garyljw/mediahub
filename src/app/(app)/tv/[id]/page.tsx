import { notFound } from "next/navigation";
import { z } from "zod";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WATCHED_CLASS, WATCHED_LABEL, type WatchedState } from "@/components/home/home-items";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAdded, formatCount, formatSize } from "@/components/library/format";
import { metaLine, seriesRatingLine } from "@/components/library/detail-format";
import { ItemPageLayout } from "@/components/library/item-page";
import { MonitoredIcon } from "@/components/library/monitored-icon";
import { EPISODE_STATUS_CLASS, EPISODE_STATUS_LABEL, STATUS_CLASS, STATUS_LABEL } from "@/components/tv/series-status";
import { SeasonPoster } from "@/components/tv/season-poster";
import { SeriesEditForm } from "@/components/tv/series-edit-form";
import { SeriesHeaderActions } from "@/components/tv/series-header-actions";
import {
  EpisodeActivityCell,
  EpisodeActivityHead,
  SeasonActivitySummary,
  SeriesActivityProvider,
  SeriesActivitySummary,
} from "@/components/tv/series-activity";
import {
  EpisodeMonitorToggle,
  EpisodeReleaseButton,
  EpisodeSearchButton,
  SeasonMonitorToggle,
  SeasonReleaseButton,
  SeasonSearchButton,
} from "@/components/tv/series-detail-actions";
import { requirePageUser } from "@/server/authz";
import { env } from "@/server/env";
import { formatLocalDateTime } from "@/server/merge/local-time";
import { seasonWatchedState, toEpisodeWatched } from "@/server/merge/watched";
import { getSeriesEpisodeWatched } from "@/server/plex/watched";
import { ArrRequestError } from "@/server/arr/request";
import { getSeriesDetail, type SeasonRow, type SeriesDetail, type SeriesDetailPage } from "@/server/arr/series-detail";

export const metadata = { title: "TV" };
// Blocking route: the page waits for Sonarr before rendering, so no Suspense fallback is needed.
export const instant = false;

// Plain digits only, and a positive id. Anything else is not a series, so it gets the not-found page.
const seriesId = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
  .refine((n) => n > 0);

// Local copies of CELL and HEAD from src/components/library/table-parts.tsx. That module is "use client", so a
// server component would get client references from it, not plain strings.
const CELL = "py-1.5 px-2";
const HEAD = "h-8 border-b py-1.5 px-2";

/** How much of a season is on disk, as a whole percent. 0 when episodeCount is 0. Capped at 100. */
function seasonProgress(season: SeasonRow): number {
  if (season.episodeCount === 0) return 0;
  return Math.min(100, Math.round((season.episodeFileCount / season.episodeCount) * 100));
}

/** The Plex watched badge for one episode, or a muted dash when Plex has no state for it. */
function WatchedBadge({ state }: { state: WatchedState | undefined }) {
  if (state === undefined) return <span className="text-muted-foreground">—</span>;
  return <Badge className={WATCHED_CLASS[state]}>{WATCHED_LABEL[state]}</Badge>;
}

function SeasonDetails({
  seriesId,
  seriesTitle,
  season,
  open,
  isAdmin,
  episodeWatched,
}: {
  seriesId: number;
  seriesTitle: string;
  season: SeasonRow;
  open: boolean;
  /** Admins get the monitor and pick buttons. Everyone gets the search button. */
  isAdmin: boolean;
  /**
   * Each episode's Plex watched state by Sonarr episode id. Null when there is no Watched column. The same map also
   * gives the season's watched badge, so the badge appears only when the column does.
   */
  episodeWatched: Map<number, WatchedState> | null;
}) {
  const progress = seasonProgress(season);
  const seasonWatched =
    episodeWatched === null ? null : seasonWatchedState(season.episodes.map((episode) => episodeWatched.get(episode.id)));
  return (
    <details open={open} className="rounded-xl border bg-card">
      <summary className="flex cursor-pointer flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <SeasonPoster src={season.posterPath === null ? null : `/api/tv/lookup-poster/${season.posterPath}`}>
          <div className="min-w-0 flex-1 space-y-2">
            <span data-poster-anchor className="block font-semibold">
              {season.label}
            </span>
            <div
              role="progressbar"
              aria-label={`${season.label} episodes on disk`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="tabular-nums">
                {formatCount(season.episodeFileCount)} / {formatCount(season.episodeCount)} episodes
              </span>
              {seasonWatched !== null && <WatchedBadge state={seasonWatched} />}
              <span className="tabular-nums text-muted-foreground">{formatCount(season.totalEpisodeCount)} total</span>
              <span className="tabular-nums text-muted-foreground">{formatSize(season.sizeOnDisk)}</span>
              <SeasonActivitySummary episodeIds={season.episodes.map((episode) => episode.id)} label={season.label} />
            </div>
          </div>
        </SeasonPoster>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center">
            {isAdmin ? (
              <SeasonMonitorToggle
                seriesId={seriesId}
                seasonNumber={season.seasonNumber}
                label={season.label}
                monitored={season.monitored}
              />
            ) : (
              <MonitoredIcon monitored={season.monitored} />
            )}
          </span>
          <SeasonSearchButton seriesId={seriesId} seasonNumber={season.seasonNumber} label={season.label} />
          {isAdmin && (
            <SeasonReleaseButton
              seriesId={seriesId}
              seriesTitle={seriesTitle}
              seasonNumber={season.seasonNumber}
              label={season.label}
            />
          )}
        </div>
      </summary>
      {season.episodes.length === 0 ? (
        <p className="border-t px-3 py-2 text-sm text-muted-foreground">No episodes.</p>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={`${HEAD} w-px whitespace-nowrap`}>Monitored</TableHead>
                <TableHead className={HEAD}>#</TableHead>
                <TableHead className={HEAD}>Title</TableHead>
                <TableHead className={HEAD}>Air date</TableHead>
                <TableHead className={HEAD}>Status</TableHead>
                {episodeWatched !== null && <TableHead className={HEAD}>Watched</TableHead>}
                <TableHead className={`${HEAD} w-48`}>
                  <EpisodeActivityHead />
                </TableHead>
                <TableHead className={HEAD}>Quality</TableHead>
                <TableHead className={`${HEAD} text-right`}>Size</TableHead>
                <TableHead className={`${HEAD} w-px whitespace-nowrap`}>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {season.episodes.map((episode) => (
                <TableRow key={episode.id}>
                  <TableCell className={`${CELL} text-center`}>
                    {isAdmin ? (
                      <EpisodeMonitorToggle
                        episodeId={episode.id}
                        episodeNumber={episode.episodeNumber}
                        seasonLabel={season.label}
                        monitored={episode.monitored}
                      />
                    ) : (
                      <MonitoredIcon monitored={episode.monitored} />
                    )}
                  </TableCell>
                  <TableCell className={`${CELL} tabular-nums`}>{episode.episodeNumber}</TableCell>
                  <TableCell className={CELL}>{episode.title}</TableCell>
                  <TableCell className={`${CELL} tabular-nums text-muted-foreground`}>
                    {formatAdded(episode.airDate)}
                  </TableCell>
                  <TableCell className={CELL}>
                    <Badge variant="outline" className={EPISODE_STATUS_CLASS[episode.status]}>
                      {EPISODE_STATUS_LABEL[episode.status]}
                    </Badge>
                  </TableCell>
                  {episodeWatched !== null && (
                    <TableCell className={CELL}>
                      <WatchedBadge state={episodeWatched.get(episode.id)} />
                    </TableCell>
                  )}
                  <EpisodeActivityCell
                    episodeId={episode.id}
                    name={`${season.label} episode ${episode.episodeNumber}`}
                  />
                  <TableCell className={`${CELL} text-muted-foreground`}>{episode.quality ?? "—"}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums`}>{formatSize(episode.size)}</TableCell>
                  <TableCell className={`${CELL} text-right`}>
                    <EpisodeSearchButton
                      episodeId={episode.id}
                      episodeNumber={episode.episodeNumber}
                      seasonLabel={season.label}
                    />
                    {isAdmin && (
                      <EpisodeReleaseButton
                        seriesTitle={seriesTitle}
                        seasonNumber={season.seasonNumber}
                        episodeId={episode.id}
                        episodeNumber={episode.episodeNumber}
                        seasonLabel={season.label}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </details>
  );
}

/** An airing time in MediaHub's display time zone, or an em dash. Formatted here on the server, see CLAUDE.md. */
function localTime(iso: string | null): string {
  return iso === null ? "—" : formatLocalDateTime(iso, env().DISPLAY_TIMEZONE);
}

/**
 * Each episode's Plex watched state. Null when there is no Plex connection, no TVDB id, or Plex doesn't list the
 * series (no column, no message). "failed" when Plex can't be read, which shows a status line instead.
 */
async function episodeWatchedFor(detail: SeriesDetail): Promise<Map<number, WatchedState> | null | "failed"> {
  if (detail.tvdbId === null) return null;
  const plexEpisodes = await getSeriesEpisodeWatched(detail.tvdbId);
  if (plexEpisodes === null || plexEpisodes === "failed") return plexEpisodes;
  const episodes = detail.seasons.flatMap((season) =>
    season.episodes.map((episode) => ({
      id: episode.id,
      tvdbId: episode.tvdbId,
      seasonNumber: season.seasonNumber,
      episodeNumber: episode.episodeNumber,
    })),
  );
  return toEpisodeWatched(episodes, plexEpisodes);
}

function SeriesView({
  page,
  isAdmin,
  episodeWatched,
  watchFailed,
}: {
  page: SeriesDetailPage;
  isAdmin: boolean;
  /** Each episode's Plex watched state, or null to leave the Watched column out. */
  episodeWatched: Map<number, WatchedState> | null;
  /** True when Plex couldn't be read, so a status line says so. */
  watchFailed: boolean;
}) {
  const { detail, profiles } = page;
  // The newest season that isn't Specials starts open. Seasons arrive newest first.
  const openSeason = detail.seasons.find((season) => season.seasonNumber !== 0)?.seasonNumber;
  // Every episode of the series, for the hero's queue line.
  const episodeIds = detail.seasons.flatMap((season) => season.episodes.map((episode) => episode.id));
  const meta = metaLine({ certification: detail.certification, runtime: detail.runtime, genres: detail.genres });
  const rating = seriesRatingLine(detail.rating);
  // The IDs were checked when the detail was mapped, so building the links from them is safe.
  const imdbUrl = detail.imdbId === null ? null : `https://www.imdb.com/title/${detail.imdbId}/`;
  const tvdbUrl = detail.tvdbId === null ? null : `https://www.thetvdb.com/?tab=series&id=${detail.tvdbId}`;
  const tmdbUrl = detail.tmdbId === null ? null : `https://www.themoviedb.org/tv/${detail.tmdbId}`;

  // One provider for the whole series, so the hero's queue line and the season rows share one poll.
  return (
    <SeriesActivityProvider key={detail.id} seriesId={detail.id}>
      <ItemPageLayout
          title={detail.title}
        year={detail.year}
        meta={meta}
        extraLines={rating === null ? [] : [rating]}
        backdropSrc={detail.hasBackdrop ? `/api/tv/${detail.id}/backdrop` : null}
        posterSrc={detail.hasPoster ? `/api/tv/${detail.id}/poster` : null}
        status={{ label: STATUS_LABEL[detail.status], className: STATUS_CLASS[detail.status] }}
        monitored={detail.monitored}
        qualityProfile={detail.qualityProfile}
        overview={detail.overview}
        actions={<SeriesHeaderActions seriesId={detail.id} title={detail.title} year={detail.year} isAdmin={isAdmin} />}
        activity={<SeriesActivitySummary episodeIds={episodeIds} title={detail.title} />}
        typeSection={
          <section aria-label="Seasons" className="space-y-3">
            <h2 className="text-lg font-semibold">Seasons</h2>
            {watchFailed && (
              <p role="status" className="inline-flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
                Couldn&apos;t load watched status from Plex.
              </p>
            )}
            {detail.seasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">No seasons.</p>
            ) : (
              detail.seasons.map((season) => (
                <SeasonDetails
                  key={season.seasonNumber}
                  seriesId={detail.id}
                  seriesTitle={detail.title}
                  season={season}
                  open={season.seasonNumber === openSeason}
                  isAdmin={isAdmin}
                  episodeWatched={episodeWatched}
                />
              ))
            )}
          </section>
        }
        facts={[
          { label: "Network", value: detail.network ?? "—" },
          {
            label: "Episodes",
            value: `${formatCount(detail.episodeFileCount)} / ${formatCount(detail.episodeCount)}`,
          },
          { label: "Size", value: formatSize(detail.sizeOnDisk) },
          { label: "Added", value: formatAdded(detail.added) },
          { label: "First aired", value: formatAdded(detail.firstAired) },
          { label: "Last aired", value: localTime(detail.lastAired) },
          { label: "Next airing", value: localTime(detail.nextAiring) },
          { label: "Language", value: detail.language ?? "—" },
        ]}
        links={[
          { label: "IMDb", url: imdbUrl },
          { label: "TVDB", url: tvdbUrl },
          { label: "TMDB", url: tmdbUrl },
        ]}
        settings={
          isAdmin ? (
            <SeriesEditForm
              seriesId={detail.id}
              current={{
                qualityProfileId: detail.qualityProfileId,
                monitored: detail.monitored,
                seriesType: detail.seriesType,
                seasonFolder: detail.seasonFolder,
                monitorNewItems: detail.monitorNewItems,
              }}
              profiles={profiles}
            />
          ) : null
        }
      />
    </SeriesActivityProvider>
  );
}

export default async function SeriesDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("admin", "requester");
  const isAdmin = user.role === "admin";

  const parsed = seriesId.safeParse((await params).id);
  if (!parsed.success) notFound();

  let page: SeriesDetailPage | null;
  try {
    page = await getSeriesDetail(parsed.data);
  } catch (error) {
    // Anything that isn't a Sonarr request failure (a config error, a bug) goes to Next's error handling.
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`TV series page: ${error.message}`);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">TV</h1>
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load this series from Sonarr.
        </p>
      </div>
    );
  }

  if (page === null) notFound();
  const watched = await episodeWatchedFor(page.detail);
  return (
    <SeriesView
      page={page}
      isAdmin={isAdmin}
      episodeWatched={watched === "failed" ? null : watched}
      watchFailed={watched === "failed"}
    />
  );
}

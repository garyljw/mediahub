import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Poster } from "@/components/poster/poster";
import { formatAdded, formatCount, formatSize } from "@/components/library/format";
import { EPISODE_STATUS_CLASS, EPISODE_STATUS_LABEL, STATUS_CLASS, STATUS_LABEL } from "@/components/tv/series-status";
import { MonitoredIcon } from "@/components/tv/series-monitored";
import { SeriesEditForm } from "@/components/tv/series-edit-form";
import { SeriesHeaderActions } from "@/components/tv/series-header-actions";
import {
  EpisodeActivityCell,
  EpisodeActivityHead,
  SeasonActivitySummary,
  SeriesActivityProvider,
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
import { ArrRequestError } from "@/server/arr/request";
import { getSeriesDetail, type SeasonRow, type SeriesDetailPage } from "@/server/arr/series-detail";

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

function SeasonDetails({
  seriesId,
  seriesTitle,
  season,
  open,
  isAdmin,
}: {
  seriesId: number;
  seriesTitle: string;
  season: SeasonRow;
  open: boolean;
  /** Admins get the monitor and pick buttons. Everyone gets the search button. */
  isAdmin: boolean;
}) {
  return (
    <details open={open} className="rounded-md border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
        <span className="font-medium">{season.label}</span>
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
        <span className="tabular-nums">
          {formatCount(season.episodeFileCount)} / {formatCount(season.episodeCount)} episodes
        </span>
        <span className="tabular-nums text-muted-foreground">{formatCount(season.totalEpisodeCount)} total</span>
        <span className="tabular-nums text-muted-foreground">{formatSize(season.sizeOnDisk)}</span>
        <SeasonActivitySummary episodeIds={season.episodes.map((episode) => episode.id)} label={season.label} />
        <SeasonSearchButton
          seriesId={seriesId}
          seasonNumber={season.seasonNumber}
          label={season.label}
        />
        {isAdmin && (
          <SeasonReleaseButton
            seriesId={seriesId}
            seriesTitle={seriesTitle}
            seasonNumber={season.seasonNumber}
            label={season.label}
          />
        )}
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

function SeriesView({ page, isAdmin }: { page: SeriesDetailPage; isAdmin: boolean }) {
  const { detail, profiles } = page;
  // The newest season that isn't Specials starts open. Seasons arrive newest first.
  const openSeason = detail.seasons.find((season) => season.seasonNumber !== 0)?.seasonNumber;
  const meta = [detail.year === null ? null : String(detail.year), detail.network].filter(
    (part): part is string => part !== null,
  );

  return (
    <div className="space-y-4">
      <Link href="/tv" className="text-sm text-muted-foreground hover:underline">
        ← TV
      </Link>
      <div className="flex items-start gap-4">
        <Poster src={detail.hasPoster ? `/api/tv/${detail.id}/poster` : null} />
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{detail.title}</h1>
          {meta.length > 0 && <p className="text-sm text-muted-foreground">{meta.join(" · ")}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Badge variant="outline" className={STATUS_CLASS[detail.status]}>
              {STATUS_LABEL[detail.status]}
            </Badge>
            <span className="inline-flex items-center gap-1">
              <MonitoredIcon monitored={detail.monitored} />
              <span>{detail.monitored ? "Monitored" : "Unmonitored"}</span>
            </span>
            <span className="text-muted-foreground">Profile: {detail.qualityProfile}</span>
          </div>
          {detail.overview !== "" && <p className="max-w-prose text-sm">{detail.overview}</p>}
          <SeriesHeaderActions seriesId={detail.id} title={detail.title} year={detail.year} isAdmin={isAdmin} />
        </div>
      </div>
      {isAdmin && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Settings</h2>
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
        </section>
      )}
      <section aria-label="Seasons" className="space-y-2">
        {detail.seasons.length === 0 ? (
          <p className="text-sm text-muted-foreground">No seasons.</p>
        ) : (
          <SeriesActivityProvider key={detail.id} seriesId={detail.id}>
            {detail.seasons.map((season) => (
              <SeasonDetails
                key={season.seasonNumber}
                seriesId={detail.id}
                seriesTitle={detail.title}
                season={season}
                open={season.seasonNumber === openSeason}
                isAdmin={isAdmin}
              />
            ))}
          </SeriesActivityProvider>
        )}
      </section>
    </div>
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
  return <SeriesView page={page} isAdmin={isAdmin} />;
}

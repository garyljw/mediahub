import Link from "next/link";
import { notFound } from "next/navigation";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Poster } from "@/components/poster/poster";
import { formatAdded, formatCount, formatSize } from "@/components/library/format";
import { EPISODE_STATUS_CLASS, EPISODE_STATUS_LABEL, STATUS_CLASS, STATUS_LABEL } from "@/components/tv/series-status";
import { requirePageUser } from "@/server/authz";
import { ArrRequestError } from "@/server/arr/request";
import { getSeriesDetail, type SeasonRow, type SeriesDetail } from "@/server/arr/series-detail";

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

function MonitoredIcon({ monitored }: { monitored: boolean }) {
  return monitored ? (
    <>
      <BookmarkCheck aria-hidden className="inline size-4 text-primary" />
      <span className="sr-only">Monitored</span>
    </>
  ) : (
    <>
      <Bookmark aria-hidden className="inline size-4 text-muted-foreground/60" />
      <span className="sr-only">Unmonitored</span>
    </>
  );
}

function SeasonDetails({ season, open }: { season: SeasonRow; open: boolean }) {
  return (
    <details open={open} className="rounded-md border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
        <span className="font-medium">{season.label}</span>
        <span className="inline-flex items-center">
          <MonitoredIcon monitored={season.monitored} />
        </span>
        <span className="tabular-nums">
          {formatCount(season.episodeFileCount)} / {formatCount(season.episodeCount)} episodes
        </span>
        <span className="tabular-nums text-muted-foreground">{formatCount(season.totalEpisodeCount)} total</span>
        <span className="tabular-nums text-muted-foreground">{formatSize(season.sizeOnDisk)}</span>
      </summary>
      {season.episodes.length === 0 ? (
        <p className="border-t px-3 py-2 text-sm text-muted-foreground">No episodes.</p>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD}>#</TableHead>
                <TableHead className={HEAD}>Title</TableHead>
                <TableHead className={HEAD}>Air date</TableHead>
                <TableHead className={HEAD}>Status</TableHead>
                <TableHead className={HEAD}>Quality</TableHead>
                <TableHead className={`${HEAD} text-right`}>Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {season.episodes.map((episode) => (
                <TableRow key={episode.id}>
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
                  <TableCell className={`${CELL} text-muted-foreground`}>{episode.quality ?? "—"}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums`}>{formatSize(episode.size)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </details>
  );
}

function SeriesView({ detail }: { detail: SeriesDetail }) {
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
        </div>
      </div>
      <section aria-label="Seasons" className="space-y-2">
        {detail.seasons.length === 0 ? (
          <p className="text-sm text-muted-foreground">No seasons.</p>
        ) : (
          detail.seasons.map((season) => (
            <SeasonDetails key={season.seasonNumber} season={season} open={season.seasonNumber === openSeason} />
          ))
        )}
      </section>
    </div>
  );
}

export default async function SeriesDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser("admin", "requester");

  const parsed = seriesId.safeParse((await params).id);
  if (!parsed.success) notFound();

  let detail: SeriesDetail | null;
  try {
    detail = await getSeriesDetail(parsed.data);
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

  if (detail === null) notFound();
  return <SeriesView detail={detail} />;
}

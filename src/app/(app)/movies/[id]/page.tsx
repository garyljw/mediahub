import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Poster } from "@/components/poster/poster";
import { formatAdded, formatRuntime, formatSize } from "@/components/library/format";
import { STATUS_CLASS, STATUS_LABEL } from "@/components/movies/movie-status";
import { MovieActivity } from "@/components/movies/movie-activity";
import { MovieDetailActions } from "@/components/movies/movie-detail-actions";
import { MovieEditForm } from "@/components/movies/movie-edit-form";
import { MonitoredIcon } from "@/components/tv/series-monitored";
import { requirePageUser } from "@/server/authz";
import { ArrRequestError } from "@/server/arr/request";
import { getMovieDetail, type MovieDetailPage } from "@/server/arr/movie-detail";

export const metadata = { title: "Movies" };
// Blocking route: the page waits for Radarr before rendering, so no Suspense fallback is needed.
export const instant = false;

// Plain digits only, and a positive id. Anything else is not a movie, so it gets the not-found page.
const movieId = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
  .refine((n) => n > 0);

function MovieView({ page, isAdmin }: { page: MovieDetailPage; isAdmin: boolean }) {
  const { detail, profiles } = page;
  const meta = [
    detail.year === null ? null : String(detail.year),
    detail.studio,
    formatRuntime(detail.runtime),
  ].filter((part): part is string => part !== null);

  return (
    <div className="space-y-4">
      <Link href="/movies" className="text-sm text-muted-foreground hover:underline">
        ← Movies
      </Link>
      <div className="flex items-start gap-4">
        <Poster src={detail.hasPoster ? `/api/movies/${detail.id}/poster` : null} />
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
          <MovieDetailActions movieId={detail.id} title={detail.title} year={detail.year} isAdmin={isAdmin} />
          <MovieActivity movieId={detail.id} title={detail.title} />
        </div>
      </div>
      {isAdmin && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Settings</h2>
          <MovieEditForm
            movieId={detail.id}
            current={{
              qualityProfileId: detail.qualityProfileId,
              monitored: detail.monitored,
              minimumAvailability: detail.minimumAvailability,
            }}
            profiles={profiles}
          />
        </section>
      )}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">File quality</dt>
        <dd>{detail.fileQuality ?? "—"}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd className="tabular-nums">{formatSize(detail.sizeOnDisk)}</dd>
        <dt className="text-muted-foreground">Added</dt>
        <dd className="tabular-nums">{formatAdded(detail.added)}</dd>
      </dl>
    </div>
  );
}

export default async function MovieDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("admin", "requester");
  const isAdmin = user.role === "admin";

  const parsed = movieId.safeParse((await params).id);
  if (!parsed.success) notFound();

  let page: MovieDetailPage | null;
  try {
    page = await getMovieDetail(parsed.data);
  } catch (error) {
    // Anything that isn't a Radarr request failure (a config error, a bug) goes to Next's error handling.
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movie page: ${error.message}`);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Movies</h1>
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load this movie from Radarr.
        </p>
      </div>
    );
  }

  if (page === null) notFound();
  return <MovieView page={page} isAdmin={isAdmin} />;
}

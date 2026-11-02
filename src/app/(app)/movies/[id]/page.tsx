import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Backdrop } from "@/components/poster/backdrop";
import { PersonPhoto } from "@/components/poster/person-photo";
import { PosterTile } from "@/components/poster/poster";
import { formatAdded, formatSize } from "@/components/library/format";
import { STATUS_CLASS, STATUS_LABEL } from "@/components/movies/movie-status";
import { directorsLine, metaLine, ratingsLine } from "@/components/movies/movie-detail-format";
import { MovieActivity } from "@/components/movies/movie-activity";
import { MovieDetailActions } from "@/components/movies/movie-detail-actions";
import { MovieEditForm } from "@/components/movies/movie-edit-form";
import { MonitoredIcon } from "@/components/tv/series-monitored";
import { requirePageUser } from "@/server/authz";
import { ArrRequestError } from "@/server/arr/request";
import { getMovieDetail, type MovieDetailPage } from "@/server/arr/movie-detail";
import type { MovieCredits } from "@/server/arr/movie-credits";

export const metadata = { title: "Movies" };
// Blocking route: the page waits for Radarr before rendering, so no Suspense fallback is needed.
export const instant = false;

// Plain digits only, and a positive id. Anything else is not a movie, so it gets the not-found page.
const movieId = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
  .refine((n) => n > 0);

/** One label and value in the details grid. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

/** The cast row, or a message when Radarr's credits failed. Omitted when the cast is empty. */
function CastRow({ credits }: { credits: MovieCredits | null }) {
  if (credits === null) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Cast</h2>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the cast from Radarr.</p>
      </section>
    );
  }
  if (credits.cast.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Cast</h2>
      <ul className="flex snap-x gap-3 overflow-x-auto pb-2">
        {credits.cast.map((member) => (
          <li key={member.id} className="w-24 shrink-0 snap-start sm:w-28">
            <PersonPhoto src={member.photo === null ? null : `/api/movies/headshot/${member.photo}`} />
            <p className="mt-1.5 line-clamp-2 text-sm font-medium">{member.name}</p>
            {member.character !== null && <p className="line-clamp-2 text-xs text-muted-foreground">{member.character}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MovieView({ page, isAdmin }: { page: MovieDetailPage; isAdmin: boolean }) {
  const { detail, profiles, credits } = page;
  const meta = metaLine({ certification: detail.certification, runtime: detail.runtime, genres: detail.genres });
  const directors = credits === null ? null : directorsLine(credits.directors);
  const ratings = ratingsLine(detail.ratings);
  // The IDs were checked when the detail was mapped, so building the links from them is safe.
  const imdbUrl = detail.imdbId === null ? null : `https://www.imdb.com/title/${detail.imdbId}/`;
  const tmdbUrl = detail.tmdbId === null ? null : `https://www.themoviedb.org/movie/${detail.tmdbId}`;

  return (
    <div className="space-y-6">
      <Link href="/movies" className="text-sm text-muted-foreground hover:underline">
        ← Movies
      </Link>

      <section className="relative overflow-hidden rounded-xl border bg-card">
        {detail.hasBackdrop && <Backdrop src={`/api/movies/${detail.id}/backdrop`} />}
        <div className="relative flex flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
          <div className="w-32 shrink-0 rounded-md shadow-lg sm:w-40 md:w-48">
            <PosterTile src={detail.hasPoster ? `/api/movies/${detail.id}/poster` : null} />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              {detail.title}
              {detail.year !== null && <span className="ml-2 font-normal text-muted-foreground">{detail.year}</span>}
            </h1>
            {meta !== null && <p className="text-sm text-muted-foreground">{meta}</p>}
            {directors !== null && <p className="text-sm">{directors}</p>}
            {ratings !== null && <p className="text-sm">{ratings}</p>}
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
      </section>

      <CastRow credits={credits} />

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">Details</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          <Fact label="File quality">{detail.fileQuality ?? "—"}</Fact>
          <Fact label="Size">{formatSize(detail.sizeOnDisk)}</Fact>
          <Fact label="Added">{formatAdded(detail.added)}</Fact>
          <Fact label="In cinemas">{formatAdded(detail.inCinemas)}</Fact>
          <Fact label="Digital release">{formatAdded(detail.digitalRelease)}</Fact>
          <Fact label="Physical release">{formatAdded(detail.physicalRelease)}</Fact>
          <Fact label="Language">{detail.language ?? "—"}</Fact>
          <Fact label="Studio">{detail.studio ?? "—"}</Fact>
        </dl>
        {(imdbUrl !== null || tmdbUrl !== null) && (
          <p className="flex flex-wrap gap-4 text-sm">
            {imdbUrl !== null && (
              <a href={imdbUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                IMDb
              </a>
            )}
            {tmdbUrl !== null && (
              <a href={tmdbUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                TMDB
              </a>
            )}
          </p>
        )}
      </section>

      {isAdmin && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold">Settings</h2>
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

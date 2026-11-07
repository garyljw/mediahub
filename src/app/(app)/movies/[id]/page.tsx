import { notFound } from "next/navigation";
import { z } from "zod";
import { PersonPhoto } from "@/components/poster/person-photo";
import { formatAdded, formatSize } from "@/components/library/format";
import { STATUS_CLASS, STATUS_LABEL } from "@/components/movies/movie-status";
import { directorsLine, metaLine, ratingsLine } from "@/components/library/detail-format";
import { ItemPageLayout } from "@/components/library/item-page";
import { MovieActivity } from "@/components/movies/movie-activity";
import { MovieDetailActions } from "@/components/movies/movie-detail-actions";
import { MovieEditForm } from "@/components/movies/movie-edit-form";
import { requirePageUser } from "@/server/authz";
import { listFocusIds } from "@/server/focus/focus";
import { ArrRequestError } from "@/server/arr/request";
import { getMovieDetail, type MovieDetailPage } from "@/server/arr/movie-detail";
import type { MovieCredits } from "@/server/arr/movie-credits";

export const metadata = { title: "Movies" };
// The page waits for Radarr before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

// Plain digits only, and a positive id. Anything else is not a movie, so it gets the not-found page.
const movieId = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
  .refine((n) => n > 0);

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

function MovieView({ page, isAdmin, inFocus }: { page: MovieDetailPage; isAdmin: boolean; inFocus: boolean }) {
  const { detail, profiles, credits } = page;
  const meta = metaLine({ certification: detail.certification, runtime: detail.runtime, genres: detail.genres });
  const directors = credits === null ? null : directorsLine(credits.directors);
  const ratings = ratingsLine(detail.ratings);
  // The IDs were checked when the detail was mapped, so building the links from them is safe.
  const imdbUrl = detail.imdbId === null ? null : `https://www.imdb.com/title/${detail.imdbId}/`;
  const tmdbUrl = detail.tmdbId === null ? null : `https://www.themoviedb.org/movie/${detail.tmdbId}`;

  return (
    <ItemPageLayout
      title={detail.title}
      year={detail.year}
      meta={meta}
      extraLines={[directors, ratings].filter((line): line is string => line !== null)}
      backdropSrc={detail.hasBackdrop ? `/api/movies/${detail.id}/backdrop` : null}
      posterSrc={detail.hasPoster ? `/api/movies/${detail.id}/poster` : null}
      status={{ label: STATUS_LABEL[detail.status], className: STATUS_CLASS[detail.status] }}
      monitored={detail.monitored}
      qualityProfile={detail.qualityProfile}
      overview={detail.overview}
      actions={
        <MovieDetailActions movieId={detail.id} title={detail.title} year={detail.year} isAdmin={isAdmin} inFocus={inFocus} />
      }
      activity={<MovieActivity movieId={detail.id} title={detail.title} />}
      typeSection={<CastRow credits={credits} />}
      facts={[
        { label: "Studio", value: detail.studio ?? "—" },
        { label: "File quality", value: detail.fileQuality ?? "—" },
        { label: "Size", value: formatSize(detail.sizeOnDisk) },
        { label: "Added", value: formatAdded(detail.added) },
        { label: "In cinemas", value: formatAdded(detail.inCinemas) },
        { label: "Digital release", value: formatAdded(detail.digitalRelease) },
        { label: "Physical release", value: formatAdded(detail.physicalRelease) },
        { label: "Language", value: detail.language ?? "—" },
      ]}
      links={[
        { label: "IMDb", url: imdbUrl },
        { label: "TMDB", url: tmdbUrl },
      ]}
      settings={
        isAdmin ? (
          <MovieEditForm
            movieId={detail.id}
            current={{
              qualityProfileId: detail.qualityProfileId,
              monitored: detail.monitored,
              minimumAvailability: detail.minimumAvailability,
            }}
            profiles={profiles}
          />
        ) : null
      }
    />
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
  return <MovieView page={page} isAdmin={isAdmin} inFocus={listFocusIds("movie").includes(page.detail.id)} />;
}

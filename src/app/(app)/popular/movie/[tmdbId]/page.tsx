import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/server/authz";
import { listMovies } from "@/server/arr/movies";
import { loadOrNull } from "@/server/arr/load-or-null";
import { loadMovieAddOptions } from "@/server/add/add-options";
import { getTmdbConfig } from "@/server/settings/tmdb";
import { isTmdbNotFound } from "@/server/tmdb/errors";
import { tmdbIdParam } from "@/server/tmdb/ids";
import { getMovieDetails } from "@/server/tmdb/client";
import { yearOf } from "@/server/merge/popular";
import { directorsLine, metaLine } from "@/components/library/detail-format";
import { formatAdded, formatRuntime } from "@/components/library/format";
import { PopularPreviewView } from "@/components/popular/preview-view";
import { PreviewAdd } from "@/components/popular/preview-add";
import {
  failureNotice,
  NotSetUp,
} from "../../preview";

export const metadata = { title: "Popular" };
// The page waits for TMDB and Radarr before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

export default async function PopularMoviePage({
  params,
}: {
  params: Promise<{ tmdbId: string }>;
}) {
  const user = await requirePageUser("admin", "requester");
  const isAdmin = user.role === "admin";

  const parsed = tmdbIdParam.safeParse((await params).tmdbId);
  if (!parsed.success) notFound();
  const tmdbId = parsed.data;

  const config = getTmdbConfig();
  if (config === null) return <NotSetUp isAdmin={isAdmin} />;

  // The library and TMDB are asked together. A 404 from TMDB is the not-found page, a title already in the library goes
  // to its own page, and otherwise the preview shows. If the library can't be read, the preview still shows.
  const libraryRead = loadOrNull(listMovies, "Popular preview");
  const detailsRead = getMovieDetails(config.token, tmdbId).then(
    (value) => ({ details: value }),
    (error: unknown) => ({ failure: error }),
  );
  const [library, outcome] = await Promise.all([libraryRead, detailsRead]);
  if ("failure" in outcome && isTmdbNotFound(outcome.failure)) notFound();
  const inLibrary = library?.rows.find((row) => row.tmdbId === tmdbId);
  if (inLibrary) redirect(`/movies/${inLibrary.id}`);
  if ("failure" in outcome) return failureNotice(outcome.failure, isAdmin);
  const details = outcome.details;

  const movieOptions = isAdmin
    ? await loadMovieAddOptions("Popular preview")
    : null;
  const year = yearOf(details.releaseDate);

  return (
    <PopularPreviewView
      title={details.title}
      year={year}
      meta={metaLine({
        certification: null,
        runtime: details.runtime,
        genres: details.genres,
      })}
      extraLines={[directorsLine(details.directors)].filter(
        (line): line is string => line !== null,
      )}
      tagline={details.tagline}
      overview={details.overview}
      backdropFile={details.backdropFile}
      posterFile={details.posterFile}
      cast={details.cast}
      facts={[
        { label: "Released", value: formatAdded(details.releaseDate) },
        { label: "Runtime", value: formatRuntime(details.runtime) ?? "—" },
      ]}
      links={[
        {
          label: "IMDb",
          url:
            details.imdbId === null
              ? null
              : `https://www.imdb.com/title/${details.imdbId}/`,
        },
        {
          label: "TMDB",
          url: `https://www.themoviedb.org/movie/${details.id}`,
        },
      ]}
      actions={
        <>
          {library === null && (
            <p role="status" className="text-sm text-muted-foreground">
              Couldn&apos;t check your library in Radarr.
            </p>
          )}
          <PreviewAdd
            kind="movie"
            tmdbId={details.id}
            title={details.title}
            year={year}
            isAdmin={isAdmin}
            movieOptions={movieOptions}
            seriesOptions={null}
          />
        </>
      }
    />
  );
}

import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/server/authz";
import { listSeries } from "@/server/arr/series";
import { loadOrNull } from "@/server/arr/load-or-null";
import { loadSeriesAddOptions } from "@/server/add/add-options";
import { getTmdbConfig } from "@/server/settings/tmdb";
import { getShowDetails } from "@/server/tmdb/client";
import { yearOf } from "@/server/merge/popular";
import { formatAdded, formatRuntime } from "@/components/library/format";
import { PopularPreviewView } from "@/components/popular/preview-view";
import { PreviewAdd } from "@/components/popular/preview-add";
import {
  failureNotice,
  isTmdbNotFound,
  NotSetUp,
  tmdbIdParam,
} from "../../preview";

export const metadata = { title: "Popular" };
// The page waits for TMDB and Sonarr before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export default async function PopularShowPage({
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
  const libraryRead = loadOrNull(listSeries, "Popular preview");
  const detailsRead = getShowDetails(config.token, tmdbId).then(
    (value) => ({ details: value }),
    (error: unknown) => ({ failure: error }),
  );
  const [library, outcome] = await Promise.all([libraryRead, detailsRead]);
  if ("failure" in outcome && isTmdbNotFound(outcome.failure)) notFound();
  const inLibrary = library?.rows.find((row) => row.tmdbId === tmdbId);
  if (inLibrary) redirect(`/tv/${inLibrary.id}`);
  if ("failure" in outcome) return failureNotice(outcome.failure, isAdmin);
  const details = outcome.details;

  const seriesOptions = isAdmin
    ? await loadSeriesAddOptions("Popular preview")
    : null;
  const year = yearOf(details.firstAirDate);
  const meta = [
    details.seasons === null ? null : plural(details.seasons, "season"),
    details.episodes === null ? null : plural(details.episodes, "episode"),
    details.networks.length > 0 ? details.networks.join(", ") : null,
    details.status,
    details.genres.length > 0 ? details.genres.join(", ") : null,
  ].filter((part): part is string => part !== null);

  return (
    <PopularPreviewView
      title={details.name}
      year={year}
      meta={meta.length > 0 ? meta.join(" · ") : null}
      extraLines={
        details.createdBy.length > 0
          ? [`Created by ${details.createdBy.join(", ")}`]
          : []
      }
      tagline={details.tagline}
      overview={details.overview}
      backdropFile={details.backdropFile}
      posterFile={details.posterFile}
      cast={details.cast}
      facts={[
        { label: "First aired", value: formatAdded(details.firstAirDate) },
        { label: "Status", value: details.status ?? "—" },
        { label: "Seasons", value: details.seasons ?? "—" },
        { label: "Episodes", value: details.episodes ?? "—" },
        {
          label: "Episode length",
          value: formatRuntime(details.runtime) ?? "—",
        },
      ]}
      links={[
        { label: "TMDB", url: `https://www.themoviedb.org/tv/${details.id}` },
      ]}
      actions={
        <>
          {library === null && (
            <p role="status" className="text-sm text-muted-foreground">
              Couldn&apos;t check your library in Sonarr.
            </p>
          )}
          <PreviewAdd
            kind="series"
            tmdbId={details.id}
            title={details.name}
            year={year}
            isAdmin={isAdmin}
            movieOptions={null}
            seriesOptions={seriesOptions}
          />
        </>
      }
    />
  );
}

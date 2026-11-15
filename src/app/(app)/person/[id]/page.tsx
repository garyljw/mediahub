import Link from "next/link";
import { notFound } from "next/navigation";
import { formatAdded } from "@/components/library/format";
import { ItemPageLayout } from "@/components/library/item-page";
import { FilmographyView } from "@/components/person/filmography-view";
import { requirePageUser } from "@/server/authz";
import { listMovies } from "@/server/arr/movies";
import { listSeries } from "@/server/arr/series";
import { loadOrNull } from "@/server/arr/load-or-null";
import { ageOn, toFilmography } from "@/server/merge/filmography";
import { libraryByTmdbId } from "@/server/merge/popular";
import { getTmdbConfig } from "@/server/settings/tmdb";
import { getPerson, getPersonCredits } from "@/server/tmdb/client";
import { isTmdbNotFound, TmdbRequestError, tmdbFailureFor } from "@/server/tmdb/errors";
import { tmdbIdParam } from "@/server/tmdb/ids";
import type { TmdbPerson } from "@/server/tmdb/schemas";

export const metadata = { title: "People" };
// The page waits for TMDB and the library before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Runs a load that may fail, so several can start together and each failure is handled on its own. */
function settle<T>(load: Promise<T>): Promise<Settled<T>> {
  return load.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
}

function PeopleNotice({ children, alert = false }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">People</h1>
      <p role={alert ? "alert" : undefined} className={alert ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
        {children}
      </p>
    </div>
  );
}

/** The notice for a failed TMDB request for the person. A non-TMDB error is rethrown. The log line holds only the safe message. */
function failureNotice(error: unknown, isAdmin: boolean) {
  if (!(error instanceof TmdbRequestError)) throw error;
  console.error(`Person page: ${error.message}`);
  const refused = error.kind === "http" && error.status === 401;
  return (
    <PeopleNotice alert>
      {tmdbFailureFor(error, isAdmin, "People's pages")}
      {refused && isAdmin && (
        <>
          {" "}
          <Link href="/settings/connections" className="underline">
            Open Settings
          </Link>
        </>
      )}
    </PeopleNotice>
  );
}

/** "Born 9 Jul 1956 (age 70) in Place", with the parts TMDB doesn't have left out. A person who has died has no age here. */
function bornLine(person: TmdbPerson, today: string): string | null {
  const parts: string[] = [];
  if (person.birthday !== null) {
    const age = person.deathday === null ? ageOn(person.birthday, today) : null;
    parts.push(`Born ${formatAdded(person.birthday)}${age === null ? "" : ` (age ${age})`}`);
  }
  if (person.placeOfBirth !== null) parts.push(person.birthday === null ? `Born in ${person.placeOfBirth}` : `in ${person.placeOfBirth}`);
  return parts.length === 0 ? null : parts.join(" ");
}

/** "Died 1 Jan 2020 (aged 63)". */
function diedLine(person: TmdbPerson): string | null {
  if (person.deathday === null) return null;
  const age = person.birthday === null ? null : ageOn(person.birthday, person.deathday);
  return `Died ${formatAdded(person.deathday)}${age === null ? "" : ` (aged ${age})`}`;
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("admin", "requester");
  const isAdmin = user.role === "admin";

  const parsed = tmdbIdParam.safeParse((await params).id);
  if (!parsed.success) notFound();
  const personId = parsed.data;

  const config = getTmdbConfig();
  if (config === null) {
    return (
      <PeopleNotice>
        {isAdmin ? (
          <>
            <Link href="/settings/connections" className="text-primary underline">
              Add a TMDB token in Settings → Connections
            </Link>{" "}
            to see people&apos;s pages.
          </>
        ) : (
          "People's pages aren't set up yet."
        )}
      </PeopleNotice>
    );
  }

  // TMDB and both libraries are asked together. A library that can't be read only means its titles link to the preview.
  const [person, credits, movies, series] = await Promise.all([
    settle(getPerson(config.token, personId)),
    settle(getPersonCredits(config.token, personId)),
    loadOrNull(listMovies, "Person page"),
    loadOrNull(listSeries, "Person page"),
  ]);
  if (!person.ok) {
    if (isTmdbNotFound(person.error)) notFound();
    return failureNotice(person.error, isAdmin);
  }
  if (!credits.ok && !(credits.error instanceof TmdbRequestError)) throw credits.error;
  if (!credits.ok) console.error(`Person page: ${(credits.error as TmdbRequestError).message}`);

  const today = new Date().toISOString().slice(0, 10);
  const info = person.value;
  const filmography = credits.ok
    ? toFilmography(
        credits.value,
        {
          movies: movies === null ? null : libraryByTmdbId(movies.rows),
          series: series === null ? null : libraryByTmdbId(series.rows),
        },
        today,
      )
    : null;

  const born = bornLine(info, today);
  const died = diedLine(info);

  return (
    <ItemPageLayout
      title={info.name}
      year={null}
      meta={info.knownFor}
      extraLines={[born, died].filter((line): line is string => line !== null)}
      backdropSrc={filmography?.backdropFile ? `/api/popular/backdrop/${filmography.backdropFile}` : null}
      posterSrc={info.photoFile === null ? null : `/api/people/photo/${info.photoFile}`}
      overview={info.biography}
      actions={null}
      clampOverview
      posterPlaceholder="person"
      typeSection={
        <section aria-label="Filmography" className="space-y-4">
          <h2 className="text-lg font-semibold">Filmography</h2>
          {filmography === null ? (
            <p className="text-sm text-muted-foreground">Couldn&apos;t load the filmography from TMDB.</p>
          ) : filmography.tiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No acting credits on TMDB.</p>
          ) : (
            // Keyed by person, so each person's page starts on All.
            <FilmographyView key={info.id} tiles={filmography.tiles} />
          )}
        </section>
      }
      // The hero already shows these, so the Details card holds only the links.
      facts={[]}
      links={[
        { label: "IMDb", url: info.imdbId === null ? null : `https://www.imdb.com/name/${info.imdbId}/` },
        { label: "TMDB", url: `https://www.themoviedb.org/person/${info.id}` },
      ]}
    />
  );
}

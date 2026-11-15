import type { ReactNode } from "react";
import { Breadcrumb, navCrumb } from "@/components/breadcrumb/breadcrumb";
import { ItemPageLayout } from "@/components/library/item-page";
import { PersonPhoto } from "@/components/poster/person-photo";
import type { TmdbCastMember } from "@/server/tmdb/schemas";

/** The cast row, in the movie page's look. A show's members also show how many episodes they were in. */
function CastRow({ cast }: { cast: TmdbCastMember[] }) {
  if (cast.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Cast</h2>
      <ul className="flex snap-x gap-3 overflow-x-auto pb-2">
        {cast.map((member) => (
          <li key={member.id} className="w-24 shrink-0 snap-start sm:w-28">
            <PersonPhoto src={member.photo === null ? null : `/api/movies/headshot/${member.photo}`} />
            <p className="mt-1.5 line-clamp-2 text-sm font-medium">{member.name}</p>
            {member.character !== null && <p className="line-clamp-2 text-xs text-muted-foreground">{member.character}</p>}
            {member.episodes !== null && (
              <p className="text-xs text-muted-foreground">{member.episodes === 1 ? "1 episode" : `${member.episodes} episodes`}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A TMDB preview of a title that isn't in the library, in the item pages' layout. The page builds the lines and facts
 * from TMDB's reply; the Add control comes in as `actions`. Image files are bare TMDB names for MediaHub's own routes.
 */
export function PopularPreviewView({
  title,
  year,
  meta,
  extraLines,
  tagline,
  overview,
  backdropFile,
  posterFile,
  cast,
  facts,
  links,
  actions,
}: {
  title: string;
  year: number | null;
  meta: string | null;
  extraLines: string[];
  tagline: string | null;
  overview: string;
  backdropFile: string | null;
  posterFile: string | null;
  cast: TmdbCastMember[];
  facts: { label: string; value: ReactNode }[];
  links: { label: string; url: string | null }[];
  actions: ReactNode;
}) {
  return (
    <ItemPageLayout
      // The trail starts at Popular, not Home.
      breadcrumb={<Breadcrumb label={title} root={navCrumb("/popular")} />}
      title={title}
      year={year}
      meta={meta}
      extraLines={tagline === null ? extraLines : [`“${tagline}”`, ...extraLines]}
      backdropSrc={backdropFile === null ? null : `/api/popular/backdrop/${backdropFile}`}
      posterSrc={posterFile === null ? null : `/api/movies/lookup-poster/${posterFile}`}
      overview={overview}
      actions={actions}
      typeSection={<CastRow cast={cast} />}
      facts={facts}
      links={links}
    />
  );
}

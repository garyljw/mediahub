import type { ReactNode } from "react";
import { Breadcrumb } from "@/components/breadcrumb/breadcrumb";
import { navCrumb } from "@/components/breadcrumb/trail";
import { ItemPageLayout } from "@/components/library/item-page";
import { CastRow } from "@/components/library/cast-row";
import type { TmdbCastMember } from "@/server/tmdb/schemas";

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
      typeSection={
        <CastRow
          members={cast.map((member) => ({
            key: member.id,
            personId: member.id,
            name: member.name,
            character: member.character,
            episodes: member.episodes,
            photo: member.photo,
          }))}
          // A preview only renders when TMDB is set up, so person pages are there to open.
          linkPeople
        />
      }
      facts={facts}
      links={links}
    />
  );
}

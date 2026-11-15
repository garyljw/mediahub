import Link from "next/link";
import { PersonPhoto } from "@/components/poster/person-photo";

export type CastRowMember = {
  key: string | number;
  /** The person's TMDB id, for their page. Null when it isn't known. */
  personId: number | null;
  name: string;
  character: string | null;
  /** Only a show's cast: how many episodes they were in. */
  episodes: number | null;
  /** A bare TMDB file name for the headshot route. */
  photo: string | null;
};

/**
 * The cast row on the movie, series and Popular preview pages. A server component. With `linkPeople`, a member with a
 * known person id opens that person's page from their photo or name. Returns nothing when there is no cast and no error.
 */
export function CastRow({
  members,
  linkPeople,
  error,
}: {
  members: CastRowMember[];
  linkPeople: boolean;
  /** Shown under the heading instead of the cast, when the cast couldn't be loaded. */
  error?: string;
}) {
  if (error !== undefined) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Cast</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
      </section>
    );
  }
  if (members.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Cast</h2>
      <ul className="flex snap-x gap-3 overflow-x-auto pb-2">
        {members.map((member) => {
          const body = (
            <>
              <div className="rounded-md ring-primary/70 transition group-hover:ring-2 group-hover:brightness-110 group-focus-visible:ring-2 motion-reduce:transition-none">
                <PersonPhoto src={member.photo === null ? null : `/api/movies/headshot/${member.photo}`} />
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm font-medium group-hover:underline">{member.name}</p>
            </>
          );
          return (
            <li key={member.key} className="w-24 shrink-0 snap-start sm:w-28">
              {linkPeople && member.personId !== null ? (
                <Link
                  href={`/person/${member.personId}`}
                  className="group block rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {body}
                </Link>
              ) : (
                <div>{body}</div>
              )}
              {member.character !== null && <p className="line-clamp-2 text-xs text-muted-foreground">{member.character}</p>}
              {member.episodes !== null && (
                <p className="text-xs text-muted-foreground">{member.episodes === 1 ? "1 episode" : `${member.episodes} episodes`}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import "server-only";
import { radarrClient } from "./client";
import { posterFileFromUrl } from "./movie-add";
import { getList } from "./request";
import type { components as RadarrComponents } from "./generated/radarr";

type CreditResource = RadarrComponents["schemas"]["CreditResource"];

/** Most cast members shown on the page. The row scrolls, but a long cast list is not needed to show the film. */
const MAX_CAST = 20;
/** Most directors shown on the page. */
const MAX_DIRECTORS = 3;

/**
 * One cast member, reduced to what the cast row shows. `photo` is a bare TMDB file name (e.g. "abc123.jpg") that
 * the headshot route validates again. Radarr's own image URLs never reach the browser.
 */
export type CastMember = {
  id: number;
  name: string;
  character: string | null;
  photo: string | null;
};

/** The movie's cast row and its directors. */
export type MovieCredits = { cast: CastMember[]; directors: string[] };

/** The headshot's TMDB file name from the credit's image list, or null when there is no usable headshot. */
function headshotFile(credit: CreditResource): string | null {
  const headshot = credit.images?.find((image) => image.coverType === "headshot");
  const remoteUrl = headshot?.remoteUrl;
  return typeof remoteUrl === "string" ? posterFileFromUrl(remoteUrl) : null;
}

/**
 * Pure: Radarr's credits to the page's cast and directors. Cast is the "cast" entries with a numeric id and a name,
 * in `order`, capped at MAX_CAST. Directors are the unique "Director" crew names, in upstream order, capped at
 * MAX_DIRECTORS. An entry with no `order` sorts last.
 */
export function toMovieCredits(credits: CreditResource[]): MovieCredits {
  const cast: CastMember[] = credits
    .filter(
      (credit): credit is CreditResource & { id: number; personName: string } =>
        credit.type === "cast" &&
        typeof credit.id === "number" &&
        typeof credit.personName === "string" &&
        credit.personName.trim() !== "",
    )
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .slice(0, MAX_CAST)
    .map((credit) => ({
      id: credit.id,
      name: credit.personName,
      character: typeof credit.character === "string" && credit.character.trim() !== "" ? credit.character : null,
      photo: headshotFile(credit),
    }));

  const directors: string[] = [];
  for (const credit of credits) {
    if (directors.length >= MAX_DIRECTORS) break;
    if (credit.type !== "crew" || credit.job !== "Director") continue;
    const name = credit.personName?.trim();
    if (name && !directors.includes(name)) directors.push(name);
  }

  return { cast, directors };
}

/** One movie's cast and directors from Radarr's credit endpoint. Only the movie id is sent. */
export async function getMovieCredits(movieId: number): Promise<MovieCredits> {
  const client = radarrClient();
  // The endpoint's 200 response has no typed body, so the list is typed here from the generated CreditResource.
  const credits = await getList<CreditResource>("Radarr credits", async (signal) => {
    const result = await client.GET("/api/v3/credit", { params: { query: { movieId } }, signal });
    return result as unknown as { data?: CreditResource[]; response: Response };
  });
  return toMovieCredits(credits);
}

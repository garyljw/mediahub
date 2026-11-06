import "server-only";

export type TitleKind = "movie" | "series";

/** One search hit in MediaHub's own shape. externalId is the TMDB id (movie) or TVDB id (series). */
export type TitleHit = {
  externalId: number;
  title: string;
  year: number | null;
  network: string | null;
  overview: string;
  posterSrc: string | null;
  inLibrary: boolean;
};

export interface TitleSearchProvider {
  search(kind: TitleKind, term: string): Promise<TitleHit[]>;
}

/** The provider couldn't complete the search. message must never contain a host, key or response body. */
export class TitleSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TitleSearchError";
  }
}

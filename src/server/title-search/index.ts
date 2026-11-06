import "server-only";

import { arrTitleSearch } from "./arr";
import type { TitleSearchProvider } from "./types";

export { TitleSearchError, type TitleHit, type TitleKind, type TitleSearchProvider } from "./types";

/**
 * The title search the Focus page uses. This is the one place to switch providers: a direct TMDB (movies) and TVDB
 * (series) provider would go here instead of arr.ts, and would also need its own poster route, since the posterSrc
 * values point at the Radarr and Sonarr poster routes.
 */
export function titleSearch(): TitleSearchProvider {
  return arrTitleSearch;
}

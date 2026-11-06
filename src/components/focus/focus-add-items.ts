// Pure helpers for the add search on a Focus page: the library match and limit, the search term, and the row keys.
// Client-safe: only type imports from src/server.
import { filterHomeItems, type HomeItem } from "@/components/home/home-items";
import { normalizeTerm } from "@/components/library/add";
import type { TitleHit } from "@/server/title-search";
import type { FocusKind } from "./focus-kinds";

/** Most library matches shown at once. */
export const LIBRARY_LIMIT = 10;
/** Shorter terms are not searched on the remote side. */
export const MIN_REMOTE_TERM = 2;

/** The library titles that match the search, in the page's order, at most LIBRARY_LIMIT. Nothing matches a blank search. */
export function libraryMatches(candidates: HomeItem[], kind: FocusKind, search: string): HomeItem[] {
  if (search.trim() === "") return [];
  return filterHomeItems(candidates, { kind, search }).slice(0, LIBRARY_LIMIT);
}

/** The trimmed term to search TMDB or TVDB for, or null when it is too short to send. */
export function remoteTerm(search: string): string | null {
  const term = normalizeTerm(search);
  return term === null || term.length < MIN_REMOTE_TERM ? null : term;
}

/** The row key for a library title. Library and remote keys never collide, so one row's state never shows on the other. */
export function libraryRowKey(item: Pick<HomeItem, "id">): string {
  return `library-${item.id}`;
}

/** The row key for a remote hit, by its TMDB or TVDB id. */
export function remoteRowKey(hit: Pick<TitleHit, "externalId">): string {
  return `remote-${hit.externalId}`;
}

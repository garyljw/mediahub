"use server";

import { z } from "zod";
import { FOCUS_APP, FOCUS_KINDS, FOCUS_NAME, type FocusKind } from "@/components/focus/focus-kinds";
import { MAX_TERM_LENGTH } from "@/components/library/add";
import { AuthzError, requireRole } from "@/server/authz";
import { addMovieAs } from "@/server/add/movie-add";
import { addSeriesAs } from "@/server/add/series-add";
import { movieExists } from "@/server/arr/movies";
import { seriesExists } from "@/server/arr/series";
import { ArrRequestError } from "@/server/arr/request";
import {
  FocusLimitError,
  FocusOrderError,
  MAX_FOCUS_ITEMS,
  addToFocus,
  listFocusIds,
  removeFromFocus,
  reorderFocus,
} from "@/server/focus/focus";
import { requestFocusSync } from "@/server/focus/plex-sync";
import { titleSearch, TitleSearchError, type TitleHit } from "@/server/title-search";

// `stale` is set when the new order no longer matches the list. The client then reloads the page for the server's order.
// `addedToLibrary` is set when addNewToFocus added the title to Radarr or Sonarr but not to the list. The client then
// marks the row as added and reloads, so the title shows under "In your library" instead of being added twice.
export type FocusResult = { ok: true } | { ok: false; error: string; stale?: true; addedToLibrary?: true };

const DENIED = "You don't have permission to change Focus lists.";
const INVALID = "That change couldn't be read. Refresh and try again.";
const STALE = "The list changed. Refresh and try again.";
const FULL = `A Focus list can hold up to ${MAX_FOCUS_ITEMS} titles. Remove one before adding another.`;
const SEARCH_DENIED = "You don't have permission to search for titles to add.";
const SEARCH_INVALID = "Enter a title to search for.";

// Arr ids are positive integers. strictObject rejects any extra key.
const ITEM_ID = z.number().int().positive();
const UNIQUE = (ids: number[]) => new Set(ids).size === ids.length;
const ItemInput = z.strictObject({ kind: z.enum(FOCUS_KINDS), id: ITEM_ID });
const RemoveInput = z.strictObject({
  kind: z.enum(FOCUS_KINDS),
  ids: z.array(ITEM_ID).min(1).max(MAX_FOCUS_ITEMS).refine(UNIQUE, "ids must be unique"),
});
const ReorderInput = z.strictObject({
  kind: z.enum(FOCUS_KINDS),
  ids: z.array(ITEM_ID).max(MAX_FOCUS_ITEMS).refine(UNIQUE, "ids must be unique"),
});

/** True when the title is in the library of its own app (Radarr for movies, Sonarr for series). */
function titleExists(kind: FocusKind, id: number): Promise<boolean> {
  return kind === "movie" ? movieExists(id) : seriesExists(id);
}

/**
 * Adds a movie or series to its Focus list (admin and requester). The title must be in its app's library, so a
 * request for a title Radarr or Sonarr doesn't have is refused. Adding one already in the list succeeds without a call
 * to the app. The Arr id only means something within its kind: a Radarr id is never looked up in Sonarr.
 */
export async function addFocusItem(input: unknown): Promise<FocusResult> {
  try {
    const { user } = await requireRole("admin", "requester");
    const parsed = ItemInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID };
    const { kind, id } = parsed.data;
    const app = FOCUS_APP[kind];

    if (!listFocusIds(kind).includes(id)) {
      let exists: boolean;
      try {
        exists = await titleExists(kind, id);
      } catch (error) {
        if (error instanceof ArrRequestError) {
          // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
          console.error(`Focus add: ${error.message}`);
          return { ok: false, error: `Couldn't reach ${app}. Try again.` };
        }
        throw error;
      }
      if (!exists) return { ok: false, error: `That title isn't in ${app}.` };
    }

    addToFocus(kind, id, user.id);
    requestFocusSync(kind);
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: DENIED };
    if (error instanceof FocusLimitError) return { ok: false, error: FULL };
    throw error;
  }
  return { ok: true };
}

/**
 * Removes items from a Focus list (admin and requester), in one write. Ids that aren't in the list are ignored. Used by
 * the tile menu (one id) and by the "Remove them" notice for titles no longer in the library.
 */
export async function removeFocusItems(input: unknown): Promise<FocusResult> {
  try {
    await requireRole("admin", "requester");
    const parsed = RemoveInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID };
    // Asks for a sync only when rows were removed, so a no-op remove doesn't touch Plex.
    if (removeFromFocus(parsed.data.kind, parsed.data.ids) > 0) requestFocusSync(parsed.data.kind);
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: DENIED };
    throw error;
  }
  return { ok: true };
}

/**
 * Sets the full new order of a Focus list (admin and requester). ids must be exactly the list's current ids, including
 * any titles no longer in the library. If the list changed in another tab, nothing is written and `stale` is set.
 */
export async function reorderFocusItems(input: unknown): Promise<FocusResult> {
  try {
    await requireRole("admin", "requester");
    const parsed = ReorderInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID };
    reorderFocus(parsed.data.kind, parsed.data.ids);
    requestFocusSync(parsed.data.kind);
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: DENIED };
    if (error instanceof FocusOrderError) return { ok: false, error: STALE, stale: true };
    throw error;
  }
  return { ok: true };
}

// strictObject rejects any extra key. The term is trimmed, and must be 1 to MAX_TERM_LENGTH characters after trimming.
const FocusSearchInput = z.strictObject({
  kind: z.enum(FOCUS_KINDS),
  term: z.string().trim().min(1).max(MAX_TERM_LENGTH),
});

export type FocusSearchResult = { ok: true; hits: TitleHit[] } | { ok: false; error: string };

/**
 * Searches TMDB (movies) or TVDB (series) for titles to add to a Focus list (admin and requester). Titles already in the
 * library are left out, because the Focus page lists those itself. The role check runs first, inside try, and the catch
 * always returns or throws. Hits carry only TitleHit fields, so no Arr resource reaches the browser.
 */
export async function searchFocusTitles(input: unknown): Promise<FocusSearchResult> {
  try {
    await requireRole("admin", "requester");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: SEARCH_DENIED };
    throw error;
  }

  const parsed = FocusSearchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: SEARCH_INVALID };
  const { kind, term } = parsed.data;

  try {
    const hits = await titleSearch().search(kind, term);
    return { ok: true, hits: hits.filter((hit) => !hit.inLibrary) };
  } catch (error) {
    if (!(error instanceof TitleSearchError)) throw error;
    return { ok: false, error: `${FOCUS_APP[kind]} couldn't complete the search. Try again.` };
  }
}

// The add is checked by the same rules as the Add page, for the caller's role. strictObject on each arm keeps the kind
// fixed, and the add itself rejects any key the caller's role doesn't allow.
const AddNewInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("movie"), add: z.unknown() }),
  z.strictObject({ kind: z.literal("series"), add: z.unknown() }),
]);

/**
 * Adds a title that isn't in the library to its app, then appends it to its Focus list (admin and requester). `add` is
 * the add the Add page takes: a requester sends only the TMDB or TVDB id and gets the saved defaults, and an admin sends
 * the panel's choices. The role check runs first, inside try, and the catch always returns or throws. If the app adds
 * the title but the list can't take it, the message says so, and the title stays in the library.
 */
export async function addNewToFocus(input: unknown): Promise<FocusResult> {
  try {
    const { user } = await requireRole("admin", "requester");
    const parsed = AddNewInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID };
    const { kind, add } = parsed.data;
    const isAdmin = user.role === "admin";
    const app = FOCUS_APP[kind];
    const name = FOCUS_NAME[kind];

    // Refuse before the add, so a full list never leaves a new title downloading that isn't in it. addToFocus checks
    // again below, in its transaction, for an add that fills the list meanwhile.
    if (listFocusIds(kind).length >= MAX_FOCUS_ITEMS) return { ok: false, error: FULL };

    const result = kind === "movie" ? await addMovieAs(isAdmin, add) : await addSeriesAs(isAdmin, add);
    if (!result.ok) return { ok: false, error: result.error };
    if (result.id === null) {
      return {
        ok: false,
        error: `Added to ${app}, but it couldn't be added to ${name}. Find it on Home and add it from there.`,
        addedToLibrary: true,
      };
    }

    try {
      addToFocus(kind, result.id, user.id);
      requestFocusSync(kind);
    } catch (error) {
      if (error instanceof FocusLimitError) {
        return {
          ok: false,
          error: `Added to ${app}, but ${name} is full (up to ${MAX_FOCUS_ITEMS} titles). Remove one, then add it from Home.`,
          addedToLibrary: true,
        };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: DENIED };
    throw error;
  }
  return { ok: true };
}

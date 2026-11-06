"use server";

import { z } from "zod";
import { FOCUS_APP, FOCUS_KINDS, type FocusKind } from "@/components/focus/focus-kinds";
import { AuthzError, requireRole } from "@/server/authz";
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

// `stale` is set when the new order no longer matches the list. The client then reloads the page for the server's order.
export type FocusResult = { ok: true } | { ok: false; error: string; stale?: true };

const DENIED = "You don't have permission to change Focus lists.";
const INVALID = "That change couldn't be read. Refresh and try again.";
const STALE = "The list changed. Refresh and try again.";
const FULL = `A Focus list can hold up to ${MAX_FOCUS_ITEMS} titles. Remove one before adding another.`;

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
    removeFromFocus(parsed.data.kind, parsed.data.ids);
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
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: DENIED };
    if (error instanceof FocusOrderError) return { ok: false, error: STALE, stale: true };
    throw error;
  }
  return { ok: true };
}

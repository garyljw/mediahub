"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { deleteMovies, editMovies, listQualityProfiles, type MovieEdit } from "@/server/arr/movies";
import { ArrRequestError } from "@/server/arr/request";
import { MAX_EDIT_MOVIES } from "@/components/movies/movie-edit";

export type EditResult = { ok: true } | { ok: false; error: string };

// strictObject rejects unknown keys. The refine requires at least one change, so an empty edit is refused.
const MovieEditInput = z
  .strictObject({
    movieIds: z.array(z.number().int().positive()).min(1).max(MAX_EDIT_MOVIES),
    qualityProfileId: z.number().int().positive().optional(),
    monitored: z.boolean().optional(),
  })
  .refine((input) => input.qualityProfileId !== undefined || input.monitored !== undefined);

/**
 * Bulk edit of Radarr movies (admin only). The role check is the first thing that runs. It sits
 * inside try so a denial returns { ok: false } instead of throwing. The catch always returns or
 * throws, so nothing after it runs without a passed check. src/app/server-actions-auth.test.ts
 * enforces this shape for every action.
 */
export async function updateMovies(input: unknown): Promise<EditResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to edit movies." };
    throw error;
  }

  const parsed = MovieEditInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid edit." };

  const { qualityProfileId, monitored } = parsed.data;
  // A Set drops duplicate ids, so Radarr gets each movie once.
  const edit: MovieEdit = { movieIds: [...new Set(parsed.data.movieIds)] };
  if (qualityProfileId !== undefined) edit.qualityProfileId = qualityProfileId;
  if (monitored !== undefined) edit.monitored = monitored;

  try {
    if (qualityProfileId !== undefined) {
      const profiles = await listQualityProfiles();
      if (!profiles.some((profile) => profile.id === qualityProfileId)) {
        return { ok: false, error: "That quality profile no longer exists." };
      }
    }
    await editMovies(edit);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movie edit: ${error.message}`);
    return { ok: false, error: "Radarr didn't accept the change. Try again." };
  }

  // The Movies page reads Radarr on every request and nothing is cached, so there is no cache entry
  // to invalidate. refresh() re-renders the current route, so the table shows the new values.
  refresh();
  return { ok: true };
}

export type DeleteResult = { ok: true; deleted: number } | { ok: false; error: string };

// strictObject rejects unknown keys (e.g. a stray moveFiles). deleteFiles and addImportExclusion are
// required, so a missing choice can never be read as "no". confirmCount must equal the de-duplicated id
// count: a sanity check that catches a UI bug sending more or fewer movies than the dialog showed. It
// compares counts only, not which movies; that's fine because only an admin can get this far.
const MovieDeleteInput = z.strictObject({
  movieIds: z.array(z.number().int().positive()).min(1).max(MAX_EDIT_MOVIES),
  deleteFiles: z.boolean(),
  addImportExclusion: z.boolean(),
  confirmCount: z.number().int().positive(),
});

/**
 * Bulk delete of Radarr movies (admin only). Same shape as updateMovies: the role check runs first,
 * inside try, and the catch always returns or throws. src/app/server-actions-auth.test.ts enforces this.
 */
export async function removeMovies(input: unknown): Promise<DeleteResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to delete movies." };
    throw error;
  }

  const parsed = MovieDeleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid delete." };

  const { deleteFiles, addImportExclusion, confirmCount } = parsed.data;
  // A Set drops duplicate ids, so Radarr gets each movie once. The count check runs on the unique ids.
  const movieIds = [...new Set(parsed.data.movieIds)];
  if (confirmCount !== movieIds.length) return { ok: false, error: "Invalid delete." };

  try {
    await deleteMovies({ movieIds, deleteFiles, addImportExclusion });
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movie delete: ${error.message}`);
    // Radarr may have deleted some or all of them anyway (certainly possible after a timeout), so
    // re-read the table rather than keep showing rows that might be gone.
    refresh();
    if (error.kind === "timeout") {
      return { ok: false, error: "Radarr is taking a long time and may still be deleting. The table has been refreshed; check it before trying again." };
    }
    // Any failure after the request was sent (a proxy 504, a dropped connection, an odd reply) is
    // ambiguous too, so don't claim nothing was deleted.
    return { ok: false, error: "Radarr didn't confirm the delete, so some movies may already be gone. The table has been refreshed; check it before trying again." };
  }

  // Nothing is cached, so refresh() is enough for the table to drop the deleted rows.
  refresh();
  return { ok: true, deleted: movieIds.length };
}

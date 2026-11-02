"use server";

import { RedirectType, redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { deleteMovies } from "@/server/arr/movies";
import { ArrRequestError } from "@/server/arr/request";

export type DeleteResult = { ok: false; error: string };

// Only the one movie id crosses from the browser. strictObject rejects any other key, and the two booleans are
// required, so a missing choice can never be read as "no".
const MovieItemDeleteInput = z.strictObject({
  movieId: z.number().int().positive(),
  deleteFiles: z.boolean(),
  addImportExclusion: z.boolean(),
});

/**
 * Deletes this movie from Radarr (admin only), for the movie page. Same role check as the table's delete, and
 * the catch always returns or throws. On success it sends the browser back to the Movies list. The redirect sits
 * outside the try, because redirect throws.
 */
export async function deleteMovie(input: unknown): Promise<DeleteResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to delete movies." };
    throw error;
  }

  const parsed = MovieItemDeleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid delete." };
  const { movieId, deleteFiles, addImportExclusion } = parsed.data;

  try {
    await deleteMovies({ movieIds: [movieId], deleteFiles, addImportExclusion });
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movie delete: ${error.message}`);
    // Radarr may have deleted it anyway (certainly possible after a timeout), so re-read the page rather than keep
    // showing an item that might be gone. If it is gone, the page shows not-found.
    refresh();
    if (error.kind === "timeout") {
      return { ok: false, error: "Radarr is taking a long time and may still be deleting. The page has been refreshed; check it before trying again." };
    }
    return { ok: false, error: "Radarr didn't confirm the delete, so the movie may already be gone. The page has been refreshed; check it before trying again." };
  }

  // replace, not push, so Back doesn't return to the deleted item's page.
  redirect("/movies", RedirectType.replace);
}

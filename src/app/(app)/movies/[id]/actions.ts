"use server";

import { RedirectType, redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { deleteMovies, editMovie, listQualityProfiles, type MovieEdit } from "@/server/arr/movies";
import { ArrRequestError } from "@/server/arr/request";
import { MINIMUM_AVAILABILITY } from "@/components/movies/movie-edit";

export type EditResult = { ok: true } | { ok: false; error: string };
export type DeleteResult = { ok: false; error: string };

// Only the one movie id and the fields the settings form offers cross from the browser. strictObject rejects any other
// key (such as a rootFolderPath or moveFiles). The refine requires at least one change, so an empty edit is refused.
const MovieItemEditInput = z
  .strictObject({
    movieId: z.number().int().positive(),
    qualityProfileId: z.number().int().positive().optional(),
    monitored: z.boolean().optional(),
    minimumAvailability: z.enum(MINIMUM_AVAILABILITY).optional(),
  })
  .refine(
    (input) =>
      input.qualityProfileId !== undefined ||
      input.monitored !== undefined ||
      input.minimumAvailability !== undefined,
  );

/**
 * Edits this movie in Radarr (admin only), for the movie page. The role check is the first thing that runs. It sits
 * inside try so a denial returns { ok: false } instead of throwing. The catch always returns or throws, so nothing
 * after it runs without a passed check. src/app/server-actions-auth.test.ts enforces this shape for every action.
 */
export async function updateMovie(input: unknown): Promise<EditResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to edit movies." };
    throw error;
  }

  const parsed = MovieItemEditInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid edit." };

  const { movieId, qualityProfileId, monitored, minimumAvailability } = parsed.data;
  const edit: MovieEdit = { movieId };
  if (qualityProfileId !== undefined) edit.qualityProfileId = qualityProfileId;
  if (monitored !== undefined) edit.monitored = monitored;
  if (minimumAvailability !== undefined) edit.minimumAvailability = minimumAvailability;

  try {
    if (qualityProfileId !== undefined) {
      const profiles = await listQualityProfiles();
      if (!profiles.some((profile) => profile.id === qualityProfileId)) {
        // Re-render so the form offers Radarr's current profiles instead of the deleted one.
        refresh();
        return { ok: false, error: "That quality profile no longer exists." };
      }
    }
    await editMovie(edit);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movie edit: ${error.message}`);
    return { ok: false, error: "Radarr didn't accept the change. Try again." };
  }

  // The movie page reads Radarr on every request and nothing is cached, so refresh() shows the new values.
  refresh();
  return { ok: true };
}

// Only the one movie id crosses from the browser. strictObject rejects any other key, and the two booleans are
// required, so a missing choice can never be read as "no".
const MovieItemDeleteInput = z.strictObject({
  movieId: z.number().int().positive(),
  deleteFiles: z.boolean(),
  addImportExclusion: z.boolean(),
});

/**
 * Deletes this movie from Radarr (admin only), for the movie page. The role check runs first, and
 * the catch always returns or throws. On success it sends the browser back to Home. The redirect sits
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
  redirect("/", RedirectType.replace);
}

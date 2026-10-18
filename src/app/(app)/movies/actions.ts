"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { editMovies, listQualityProfiles, type MovieEdit } from "@/server/arr/movies";
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

import "server-only";

import { refresh } from "next/cache";
import { z } from "zod";
import { ArrRequestError } from "@/server/arr/request";
import { MovieAddError, addMovie, listRootFolders } from "@/server/arr/movie-add";
import { listQualityProfiles } from "@/server/arr/movies";
import { getMovieAddDefaults } from "@/server/settings/add-defaults";
import { resolveAddTarget } from "@/server/settings/add-target";

export type AddResult = { ok: true; id: number | null; title: string; year: number | null } | { ok: false; error: string };

// Requesters send only the TMDB id. strictObject rejects any other key, so a requester cannot pick a profile,
// a folder or monitoring.
const RequesterMovieAddInput = z.strictObject({
  tmdbId: z.number().int().positive(),
});

// Admins send every choice the add panel shows. All fields are required, and strictObject rejects any other key.
const AdminMovieAddInput = z.strictObject({
  tmdbId: z.number().int().positive(),
  qualityProfileId: z.number().int().positive(),
  rootFolderId: z.number().int().positive(),
  monitored: z.boolean(),
  searchForMovie: z.boolean(),
});

/** One add, as the action sees it after the role check. The requested ids are set for an admin only. */
type MovieAddRequest = {
  tmdbId: number;
  requestedProfileId?: number;
  requestedRootFolderId?: number;
  monitored: boolean;
  searchForMovie: boolean;
};

/**
 * The add itself, once the role is known. Callers check the role first (requireRole) and pass whether the caller is an
 * admin. A requester sends only the TMDB id, and the saved Add defaults decide the profile and folder (or the first item
 * when those are missing), with the movie monitored and search on. An admin also sends the profile, folder, monitored and
 * search choices. The catch maps every failure to a message, and only anything else is rethrown.
 */
export async function addMovieAs(isAdmin: boolean, input: unknown): Promise<AddResult> {
  let request: MovieAddRequest;
  if (isAdmin) {
    const parsed = AdminMovieAddInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid add." };
    request = {
      tmdbId: parsed.data.tmdbId,
      requestedProfileId: parsed.data.qualityProfileId,
      requestedRootFolderId: parsed.data.rootFolderId,
      monitored: parsed.data.monitored,
      searchForMovie: parsed.data.searchForMovie,
    };
  } else {
    const parsed = RequesterMovieAddInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid add." };
    request = { tmdbId: parsed.data.tmdbId, monitored: true, searchForMovie: true };
  }
  const { tmdbId, requestedProfileId, requestedRootFolderId, monitored, searchForMovie } = request;

  // Set by addMovie's onSend, just before the add request goes out. Only a timeout after that point can mean
  // Radarr added the movie; a timeout in the lookup or the library check before it cannot.
  let addSent = false;
  try {
    const [profiles, folders] = await Promise.all([listQualityProfiles(), listRootFolders()]);
    const target = resolveAddTarget({
      app: "Radarr",
      noun: "movies",
      profiles,
      folders,
      saved: getMovieAddDefaults(),
      requestedProfileId,
      requestedRootFolderId,
    });
    if (!target.ok) return { ok: false, error: target.error };

    const added = await addMovie(
      {
        tmdbId,
        qualityProfileId: target.qualityProfileId,
        rootFolderPath: target.rootFolderPath,
        monitored,
        searchForMovie,
      },
      () => {
        addSent = true;
      },
    );
    // The library reads Radarr on every request, so refresh() is enough for the new row to appear.
    refresh();
    return { ok: true, id: added.id, title: added.title, year: added.year };
  } catch (error) {
    if (error instanceof MovieAddError) {
      if (error.reason === "exists") return { ok: false, error: "That movie is already in your library." };
      return { ok: false, error: "Radarr couldn't find that movie." };
    }
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Movie add: ${error.message}`);
    // A timeout means Radarr may have finished the add after we gave up, so the user must check the library.
    if (addSent && error.kind === "timeout") {
      return {
        ok: false,
        error: "Radarr took too long to answer. The movie may still have been added, so reload the page to check.",
      };
    }
    return { ok: false, error: "Radarr didn't accept the movie. Try again." };
  }
}

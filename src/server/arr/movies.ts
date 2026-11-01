import "server-only";
import { radarrClient } from "./client";
import { DELETE_TIMEOUT_MS, arrRequest, getList } from "./request";
import { fetchPosterBytes } from "./poster";
import { sortedProfileOptions, usableProfiles, type QualityProfileOption } from "./profiles";
import type { components as RadarrComponents } from "./generated/radarr";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];
type QualityProfileResource = RadarrComponents["schemas"]["QualityProfileResource"];
type MovieEditorResource = RadarrComponents["schemas"]["MovieEditorResource"];

export type MovieStatus = "downloaded" | "missing" | "unreleased";

/** One movie, reduced to the fields the Movies table shows. */
export type MovieRow = {
  id: number;
  title: string;
  year: number | null;
  status: MovieStatus;
  monitored: boolean;
  qualityProfileId: number;
  qualityProfile: string;
  fileQuality: string | null;
  sizeOnDisk: number;
  added: string | null;
  sortTitle: string;
  /** True when Radarr has a poster for the movie. The browser then fetches it from MediaHub's poster route. */
  hasPoster: boolean;
};

function movieStatus(movie: MovieResource): MovieStatus {
  if (movie.hasFile) return "downloaded";
  if (movie.isAvailable) return "missing";
  return "unreleased";
}

/**
 * Pure: maps upstream movies to table rows, in upstream order. Skips movies without an
 * id or title. Sorting is the table's job (movie-filters.ts), so it lives in one place.
 */
export function toMovieRows(movies: MovieResource[], profiles: QualityProfileResource[]): MovieRow[] {
  const profileNames = new Map(usableProfiles(profiles).map((p) => [p.id, p.name]));

  const rows: MovieRow[] = [];
  for (const movie of movies) {
    if (typeof movie.id !== "number" || !movie.title) continue;
    const status = movieStatus(movie);
    // Radarr always sends a profile id; 0 is only a fallback that matches no profile.
    const qualityProfileId = movie.qualityProfileId ?? 0;
    rows.push({
      id: movie.id,
      title: movie.title,
      year: typeof movie.year === "number" && movie.year > 0 ? movie.year : null,
      status,
      monitored: movie.monitored ?? false,
      qualityProfileId,
      // The filter dropdown reuses this label for orphaned ids, so the two always match.
      qualityProfile: profileNames.get(qualityProfileId) ?? `Unknown profile (#${qualityProfileId})`,
      fileQuality: status === "downloaded" ? (movie.movieFile?.quality?.quality?.name ?? null) : null,
      sizeOnDisk: status === "downloaded" ? (movie.sizeOnDisk ?? 0) : 0,
      added: movie.added ?? null,
      sortTitle: (movie.sortTitle || movie.title).toLowerCase(),
      hasPoster: movie.images?.some((image) => image.coverType === "poster") ?? false,
    });
  }

  return rows;
}

async function fetchQualityProfiles(): Promise<QualityProfileResource[]> {
  const client = radarrClient();
  return getList("Radarr quality profile", (signal) => client.GET("/api/v3/qualityprofile", { signal }));
}

/** Quality profiles as dropdown options. Used by the edit action to check a chosen profile still exists. */
export async function listQualityProfiles(): Promise<QualityProfileOption[]> {
  return sortedProfileOptions(await fetchQualityProfiles());
}

/** Movies (as table rows) and quality profiles (as dropdown options) from Radarr. */
export async function listMovies(): Promise<{ rows: MovieRow[]; profiles: QualityProfileOption[] }> {
  const client = radarrClient();
  const [movies, profiles] = await Promise.all([
    getList("Radarr movie", (signal) => client.GET("/api/v3/movie", { signal })),
    fetchQualityProfiles(),
  ]);

  return { rows: toMovieRows(movies, profiles), profiles: sortedProfileOptions(profiles) };
}

/**
 * A bulk edit. Only these two fields are sent, so Radarr never sees moveFiles, deleteFiles,
 * rootFolderPath, tags or anything else from the editor resource.
 */
export type MovieEdit = { movieIds: number[]; qualityProfileId?: number; monitored?: boolean };

/** Builds the editor body. Fields that are undefined are left out, not sent as null. */
function movieEditorBody(edit: MovieEdit): MovieEditorResource {
  const body: MovieEditorResource = { movieIds: edit.movieIds };
  if (edit.qualityProfileId !== undefined) body.qualityProfileId = edit.qualityProfileId;
  if (edit.monitored !== undefined) body.monitored = edit.monitored;
  return body;
}

/** Changes the quality profile and/or monitored flag for the given Radarr movie ids. */
export async function editMovies(edit: MovieEdit): Promise<void> {
  const client = radarrClient();
  const body = movieEditorBody(edit);
  await arrRequest("Radarr movie edit", (signal) => client.PUT("/api/v3/movie/editor", { body, signal }));
}

/**
 * A bulk delete. Both booleans are always sent, so Radarr never falls back to its own defaults
 * for either one.
 */
export type MovieDelete = { movieIds: number[]; deleteFiles: boolean; addImportExclusion: boolean };

/** Builds the delete body with exactly these three fields. Nothing else from the editor resource is sent. */
function movieDeleteBody(del: MovieDelete): MovieEditorResource {
  return { movieIds: del.movieIds, deleteFiles: del.deleteFiles, addImportExclusion: del.addImportExclusion };
}

/** Deletes the given Radarr movies, optionally with their files and with an import exclusion. */
export async function deleteMovies(del: MovieDelete): Promise<void> {
  const client = radarrClient();
  const body = movieDeleteBody(del);
  await arrRequest("Radarr movie delete", (signal) => client.DELETE("/api/v3/movie/editor", { body, signal }), {
    timeoutMs: DELETE_TIMEOUT_MS,
  });
}

/**
 * Asks Radarr to search for releases for the given movies (its MoviesSearch command). Radarr queues the
 * command and answers at once; the searching and any grabbing happen afterwards. Only the command name
 * and the ids are sent.
 */
export async function searchMovieReleases(movieIds: number[]): Promise<void> {
  const client = radarrClient();
  // CommandResource doesn't declare the command's own fields (movieIds), so the body is built as a variable.
  const body = { name: "MoviesSearch", movieIds };
  await arrRequest("Radarr movie search command", (signal) => client.POST("/api/v3/command", { body, signal }));
}

/**
 * Asks Radarr to refresh metadata and rescan disk for the given movies (its RefreshMovie command, the same one
 * its "Refresh & Scan" button sends). Radarr re-reads each movie's folder on disk. It queues the command and
 * answers at once. Only the command name and the ids are sent.
 */
export async function refreshMovies(movieIds: number[]): Promise<void> {
  const client = radarrClient();
  // CommandResource doesn't declare the command's own fields (movieIds), so the body is built as a variable.
  const body = { name: "RefreshMovie", movieIds };
  await arrRequest("Radarr movie refresh command", (signal) => client.POST("/api/v3/command", { body, signal }));
}

/** The one Radarr cover file MediaHub ever fetches. A module constant, so callers never choose the filename. */
const POSTER_FILENAME = "poster-250.jpg";

/** Fetches Radarr's cached 250px poster for one movie as JPEG bytes. Only the fixed poster file is requested. */
export async function getMoviePoster(movieId: number): Promise<Uint8Array<ArrayBuffer>> {
  const client = radarrClient();
  return fetchPosterBytes("Radarr poster", (signal) =>
    client.GET("/api/v3/mediacover/{movieId}/{filename}", {
      params: { path: { movieId, filename: POSTER_FILENAME } },
      parseAs: "stream",
      signal,
    }),
  );
}

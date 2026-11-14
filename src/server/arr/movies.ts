import "server-only";
import { radarrClient } from "./client";
import { cachedArrImage } from "@/server/image-cache";
import { ArrRequestError, DELETE_TIMEOUT_MS, arrRequest, getList } from "./request";
import { MAX_BACKDROP_BYTES, fetchPosterBytes } from "./poster";
import { toPeek, type Peek } from "@/server/merge/peek";
import { sortedProfileOptions, usableProfiles, type QualityProfileOption } from "./profiles";
import type { MinimumAvailability } from "@/components/movies/movie-edit";
import type { components as RadarrComponents } from "./generated/radarr";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];
type QualityProfileResource = RadarrComponents["schemas"]["QualityProfileResource"];
type MovieEditorResource = RadarrComponents["schemas"]["MovieEditorResource"];

export type MovieStatus = "downloaded" | "missing" | "unreleased";

/** One movie, reduced to the fields the library shows. */
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
  /**
   * When the movie first came out: the earliest of its cinema, digital and physical dates. Radarr's own releaseDate is
   * not used, because for older films it is a later home-video date (a 1955 film showed 1969). Null when none is known.
   */
  releaseDate: string | null;
  /** The latest of the movie's cinema, digital and physical dates (a future date counts). Null when none is known. */
  latestReleaseDate: string | null;
  /**
   * When Radarr created the movie's file record (movieFile.dateAdded). Radarr also changes it without a download, so the
   * Home sort uses the import history instead and only falls back to this. Null unless the movie is downloaded.
   */
  fileAddedAt: string | null;
  sortTitle: string;
  /** True when Radarr has a poster for the movie. The browser then fetches it from MediaHub's poster route. */
  hasPoster: boolean;
  /** The TMDB id, used to match the movie to Plex. Server-only: never copied into the Home items. */
  tmdbId: number | null;
};

/** The earliest or latest date that parses, as Radarr sent it, or null when none does. */
function pickDate(dates: (string | null | undefined)[], which: "earliest" | "latest"): string | null {
  const sign = which === "earliest" ? 1 : -1;
  let picked: string | null = null;
  let pickedTime = Number.NaN;
  for (const date of dates) {
    if (typeof date !== "string") continue;
    const time = Date.parse(date);
    if (Number.isNaN(time)) continue;
    if (picked !== null && sign * (time - pickedTime) >= 0) continue;
    picked = date;
    pickedTime = time;
  }
  return picked;
}

function movieStatus(movie: MovieResource): MovieStatus {
  if (movie.hasFile) return "downloaded";
  if (movie.isAvailable) return "missing";
  return "unreleased";
}

/**
 * Pure: maps upstream movies to rows, in upstream order. Skips movies without an id or title. Sorting is
 * done by the caller.
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
      // The profile filter reuses this label for orphaned ids, so the two always match.
      qualityProfile: profileNames.get(qualityProfileId) ?? `Unknown profile (#${qualityProfileId})`,
      fileQuality: status === "downloaded" ? (movie.movieFile?.quality?.quality?.name ?? null) : null,
      sizeOnDisk: status === "downloaded" ? (movie.sizeOnDisk ?? 0) : 0,
      added: movie.added ?? null,
      releaseDate: pickDate([movie.inCinemas, movie.digitalRelease, movie.physicalRelease], "earliest"),
      latestReleaseDate: pickDate([movie.inCinemas, movie.digitalRelease, movie.physicalRelease], "latest"),
      fileAddedAt: status === "downloaded" ? (movie.movieFile?.dateAdded ?? null) : null,
      sortTitle: (movie.sortTitle || movie.title).toLowerCase(),
      hasPoster: movie.images?.some((image) => image.coverType === "poster") ?? false,
      tmdbId: typeof movie.tmdbId === "number" && Number.isSafeInteger(movie.tmdbId) && movie.tmdbId > 0 ? movie.tmdbId : null,
    });
  }

  return rows;
}

export async function fetchQualityProfiles(): Promise<QualityProfileResource[]> {
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
 * An edit to one movie, from the movie's own page. The editor endpoint takes a list of ids, so the body carries
 * this movie's id alone. Only these fields are sent, so Radarr never sees moveFiles, deleteFiles, rootFolderPath,
 * tags or anything else from the editor resource.
 */
export type MovieEdit = {
  movieId: number;
  qualityProfileId?: number;
  monitored?: boolean;
  minimumAvailability?: MinimumAvailability;
};

/** Builds the editor body: the one id, plus each field that is defined. Undefined fields are left out, not sent as null. */
function movieEditorBody(edit: MovieEdit): MovieEditorResource {
  const body: MovieEditorResource = { movieIds: [edit.movieId] };
  if (edit.qualityProfileId !== undefined) body.qualityProfileId = edit.qualityProfileId;
  if (edit.monitored !== undefined) body.monitored = edit.monitored;
  if (edit.minimumAvailability !== undefined) body.minimumAvailability = edit.minimumAvailability;
  return body;
}

/** Changes the quality profile, monitored flag and/or minimum availability of one Radarr movie. */
export async function editMovie(edit: MovieEdit): Promise<void> {
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

async function fetchMoviePoster(movieId: number): Promise<Uint8Array<ArrayBuffer>> {
  const client = radarrClient();
  return fetchPosterBytes("Radarr poster", (signal) =>
    client.GET("/api/v3/mediacover/{movieId}/{filename}", {
      params: { path: { movieId, filename: POSTER_FILENAME } },
      parseAs: "stream",
      signal,
    }),
  );
}

/** The one Radarr backdrop file MediaHub ever fetches. A module constant, like POSTER_FILENAME. */
const BACKDROP_FILENAME = "fanart.jpg";

async function fetchMovieBackdrop(movieId: number): Promise<Uint8Array<ArrayBuffer>> {
  const client = radarrClient();
  return fetchPosterBytes(
    "Radarr backdrop",
    (signal) =>
      client.GET("/api/v3/mediacover/{movieId}/{filename}", {
        params: { path: { movieId, filename: BACKDROP_FILENAME } },
        parseAs: "stream",
        signal,
      }),
    MAX_BACKDROP_BYTES,
  );
}

/** Radarr's cached 250px poster for one movie, as JPEG bytes, through the disk image cache. */
export async function getMoviePoster(movieId: number): Promise<Uint8Array<ArrayBuffer>> {
  return cachedArrImage("radarr", "poster", movieId, () => fetchMoviePoster(movieId));
}

/** Radarr's backdrop (fanart) for one movie, as JPEG bytes, through the disk image cache. */
export async function getMovieBackdrop(movieId: number): Promise<Uint8Array<ArrayBuffer>> {
  return cachedArrImage("radarr", "backdrop", movieId, () => fetchMovieBackdrop(movieId));
}

/**
 * True when Radarr has the movie with this id, false when it answers 404. Any other failure (ArrRequestError) propagates,
 * so a Radarr outage is never read as "the movie is gone".
 */
export async function movieExists(movieId: number): Promise<boolean> {
  const client = radarrClient();
  try {
    const movie = await arrRequest("Radarr movie", (signal) =>
      client.GET("/api/v3/movie/{id}", { params: { path: { id: movieId } }, signal }),
    );
    return Boolean(movie);
  } catch (error) {
    if (error instanceof ArrRequestError && error.status === 404) return false;
    throw error;
  }
}

/**
 * The hover-card facts for one movie (year, genres, overview), or null when Radarr answers 404 or the movie has
 * nothing to show. Any other failure (ArrRequestError) propagates. Only the three Peek fields leave this function.
 */
export async function getMoviePeek(movieId: number): Promise<Peek | null> {
  const client = radarrClient();
  try {
    const movie = await arrRequest("Radarr movie", (signal) =>
      client.GET("/api/v3/movie/{id}", { params: { path: { id: movieId } }, signal }),
    );
    return toPeek(movie);
  } catch (error) {
    if (error instanceof ArrRequestError && error.status === 404) return null;
    throw error;
  }
}

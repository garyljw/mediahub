import "server-only";
import { radarrClient } from "./client";
import { ArrRequestError, arrRequest } from "./request";
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

export type QualityProfileOption = { id: number; name: string };

function movieStatus(movie: MovieResource): MovieStatus {
  if (movie.hasFile) return "downloaded";
  if (movie.isAvailable) return "missing";
  return "unreleased";
}

/**
 * Profiles with an id and a name, as dropdown options. toMovieRows and listMovies both use this,
 * so the row labels and the filter options always agree on which profiles exist.
 */
function usableProfiles(profiles: QualityProfileResource[]): QualityProfileOption[] {
  const options: QualityProfileOption[] = [];
  for (const profile of profiles) {
    if (typeof profile.id === "number" && profile.name) options.push({ id: profile.id, name: profile.name });
  }
  return options;
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

async function getList<T>(label: string, get: (signal: AbortSignal) => Promise<{ data?: T[]; response: Response }>): Promise<T[]> {
  const data = await arrRequest(label, get);
  if (!Array.isArray(data)) throw new ArrRequestError(`${label} response was not a list`, "invalid");
  return data;
}

/** Upstream profiles, reduced to usable options and sorted by name. Shared by listMovies and listQualityProfiles. */
function sortedProfileOptions(profiles: QualityProfileResource[]): QualityProfileOption[] {
  const options = usableProfiles(profiles);
  options.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return options;
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

/** Deleting many movies with their files can take a while on a NAS, so deletes get longer than the default. */
export const DELETE_TIMEOUT_MS = 120_000;

/** Deletes the given Radarr movies, optionally with their files and with an import exclusion. */
export async function deleteMovies(del: MovieDelete): Promise<void> {
  const client = radarrClient();
  const body = movieDeleteBody(del);
  await arrRequest("Radarr movie delete", (signal) => client.DELETE("/api/v3/movie/editor", { body, signal }), {
    timeoutMs: DELETE_TIMEOUT_MS,
  });
}

/** The one Radarr cover file MediaHub ever fetches. A module constant, so callers never choose the filename. */
const POSTER_FILENAME = "poster-250.jpg";

/** Largest poster we accept. Radarr's 250px thumbnail is far smaller, so anything bigger is not what we asked for. */
export const MAX_POSTER_BYTES = 2 * 1024 * 1024;

/**
 * Reads a body into memory, up to `max` bytes. Returns null as soon as it goes over and cancels the
 * rest, so an oversized response never gets fully buffered on the NAS.
 */
async function readCapped(body: ReadableStream<Uint8Array> | null | undefined, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Every JPEG starts with these bytes. Anything else (e.g. a proxy's HTML login page) is not served as a poster. */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Fetches Radarr's cached 250px poster for one movie as JPEG bytes. Only the fixed poster file is requested. */
export async function getMoviePoster(movieId: number): Promise<Uint8Array<ArrayBuffer>> {
  const client = radarrClient();
  // The body is read inside the request callback, so the timeout covers it and read failures are
  // reported like any other request failure. On an error response body is undefined (openapi-fetch
  // has already consumed it), and arrRequest throws on the status.
  const data = await arrRequest("Radarr poster", async (signal) => {
    const { data: body, response } = await client.GET("/api/v3/mediacover/{movieId}/{filename}", {
      params: { path: { movieId, filename: POSTER_FILENAME } },
      parseAs: "stream",
      signal,
    });
    return { data: await readCapped(body, MAX_POSTER_BYTES), response };
  });
  if (!data || !isJpeg(data)) {
    throw new ArrRequestError("Radarr poster response was not a usable image", "invalid");
  }
  return data;
}

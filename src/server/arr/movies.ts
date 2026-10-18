import "server-only";
import { radarrClient } from "./client";
import { ArrRequestError, arrRequest } from "./request";
import type { components as RadarrComponents } from "./generated/radarr";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];
type QualityProfileResource = RadarrComponents["schemas"]["QualityProfileResource"];

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
    });
  }

  return rows;
}

async function getList<T>(label: string, get: (signal: AbortSignal) => Promise<{ data?: T[]; response: Response }>): Promise<T[]> {
  const data = await arrRequest(label, get);
  if (!Array.isArray(data)) throw new ArrRequestError(`${label} response was not a list`);
  return data;
}

/** Movies (as table rows) and quality profiles (as dropdown options) from Radarr. */
export async function listMovies(): Promise<{ rows: MovieRow[]; profiles: QualityProfileOption[] }> {
  const client = radarrClient();
  const [movies, profiles] = await Promise.all([
    getList("Radarr movie", (signal) => client.GET("/api/v3/movie", { signal })),
    getList("Radarr quality profile", (signal) => client.GET("/api/v3/qualityprofile", { signal })),
  ]);

  const options = usableProfiles(profiles);
  options.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

  return { rows: toMovieRows(movies, profiles), profiles: options };
}

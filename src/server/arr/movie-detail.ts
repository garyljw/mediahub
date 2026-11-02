import "server-only";
import { radarrClient } from "./client";
import { ArrRequestError, arrRequest } from "./request";
import { fetchQualityProfiles, toMovieRows, type MovieStatus } from "./movies";
import type { components as RadarrComponents } from "./generated/radarr";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];
type QualityProfileResource = RadarrComponents["schemas"]["QualityProfileResource"];

/** One movie, reduced to what the movie page shows. No file paths, no root folder. */
export type MovieDetail = {
  id: number;
  title: string;
  year: number | null;
  status: MovieStatus;
  overview: string;
  studio: string | null;
  /** Runtime in minutes, or null when Radarr has none (or 0). */
  runtime: number | null;
  monitored: boolean;
  qualityProfile: string;
  /** The file's quality name when the movie is downloaded, otherwise null. */
  fileQuality: string | null;
  /** The file's size in bytes, or 0 when the movie isn't downloaded. */
  sizeOnDisk: number;
  added: string | null;
  hasPoster: boolean;
};

/**
 * Pure: maps one movie and the quality profiles to the movie page's shape. Returns null when the movie has no
 * numeric id or no title. The status, profile label and file fields come from toMovieRows, so the table and the
 * page agree.
 */
export function toMovieDetail(movie: MovieResource, profiles: QualityProfileResource[]): MovieDetail | null {
  const [row] = toMovieRows([movie], profiles);
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    year: row.year,
    status: row.status,
    overview: movie.overview ?? "",
    studio: movie.studio || null,
    runtime: typeof movie.runtime === "number" && movie.runtime > 0 ? movie.runtime : null,
    monitored: row.monitored,
    qualityProfile: row.qualityProfile,
    fileQuality: row.fileQuality,
    sizeOnDisk: row.sizeOnDisk,
    added: row.added,
    hasPoster: row.hasPoster,
  };
}

/**
 * One movie for the movie page. Returns null when Radarr answers 404 for the movie itself, so the page can show
 * not-found. A 404 from the profile request means something else (e.g. a wrong URL base), so it propagates like
 * any other failure.
 */
export async function getMovieDetail(movieId: number): Promise<MovieDetail | null> {
  const client = radarrClient();
  const movieRequest = arrRequest("Radarr movie", (signal) =>
    client.GET("/api/v3/movie/{id}", { params: { path: { id: movieId } }, signal }),
  ).catch((error: unknown) => {
    if (error instanceof ArrRequestError && error.status === 404) return null;
    throw error;
  });
  const [movie, profiles] = await Promise.all([movieRequest, fetchQualityProfiles()]);
  if (movie === null) return null;
  if (!movie) throw new ArrRequestError("Radarr movie response was empty", "invalid");
  return toMovieDetail(movie, profiles);
}

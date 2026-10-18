import "server-only";
import { radarrClient } from "./client";
import { getList } from "./movies";
import { arrRequest } from "./request";
import type { components as RadarrComponents } from "./generated/radarr";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];
type RootFolderResource = RadarrComponents["schemas"]["RootFolderResource"];

/** One TMDB search hit, reduced to what the add dialog shows. Nothing else from Radarr's resource reaches the browser. */
export type LookupResult = {
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string;
  /** True when the movie is already in the Radarr library. */
  inLibrary: boolean;
};

/** A root folder the add dialog can choose. The browser sends its id; the server resolves the path. */
export type RootFolderOption = { id: number; path: string; freeSpace: number | null };

/** What the server needs to add one movie. The browser never sends a path or a title. */
export type MovieAdd = {
  tmdbId: number;
  qualityProfileId: number;
  rootFolderPath: string;
  monitored: boolean;
  searchForMovie: boolean;
};

/** Longest overview sent to the browser. Longer text is cut and ends with an ellipsis. */
const MAX_OVERVIEW = 300;
/** Most search hits returned. Radarr can return hundreds; the dialog only needs a short list. */
const MAX_RESULTS = 20;

/**
 * Why an add was refused: "not-found" when TMDB has no usable title for the id, "exists" when the
 * movie is already in the library. Thrown from addMovie and mapped to messages in the action.
 */
export class MovieAddError extends Error {
  constructor(readonly reason: "not-found" | "exists") {
    super(reason === "exists" ? "movie already in library" : "movie not found");
    this.name = "MovieAddError";
  }
}

/** Radarr's year when it is a real year, otherwise null. Same rule as toMovieRows. */
function yearOrNull(year: unknown): number | null {
  return typeof year === "number" && year > 0 ? year : null;
}

/** Pure: Radarr search hits to dialog results, in upstream order, capped at MAX_RESULTS. */
export function toLookupResults(movies: MovieResource[], libraryTmdbIds: Set<number>): LookupResult[] {
  const results: LookupResult[] = [];
  for (const movie of movies) {
    if (results.length >= MAX_RESULTS) break;
    if (typeof movie.tmdbId !== "number" || !(movie.tmdbId > 0)) continue;
    if (!movie.title) continue;
    const overview = movie.overview ?? "";
    results.push({
      tmdbId: movie.tmdbId,
      title: movie.title,
      year: yearOrNull(movie.year),
      overview: overview.length > MAX_OVERVIEW ? `${overview.slice(0, MAX_OVERVIEW - 1)}…` : overview,
      inLibrary: libraryTmdbIds.has(movie.tmdbId),
    });
  }
  return results;
}

/**
 * Searches TMDB through Radarr. The term goes in the typed client's query, never into a URL string.
 * The library lookup runs in parallel so each hit can say whether it is already in the library.
 */
export async function lookupMovies(term: string): Promise<LookupResult[]> {
  const client = radarrClient();
  const [hits, library] = await Promise.all([
    getList("Radarr movie lookup", (signal) => client.GET("/api/v3/movie/lookup", { params: { query: { term } }, signal })),
    getList("Radarr movie", (signal) => client.GET("/api/v3/movie", { signal })),
  ]);
  const libraryTmdbIds = new Set<number>();
  for (const movie of library) {
    if (typeof movie.tmdbId === "number") libraryTmdbIds.add(movie.tmdbId);
  }
  return toLookupResults(hits, libraryTmdbIds);
}

/** Pure: root folders to dialog options. Skips entries without a numeric id or a path. Sorted by path. */
export function toRootFolderOptions(folders: RootFolderResource[]): RootFolderOption[] {
  const options: RootFolderOption[] = [];
  for (const folder of folders) {
    if (typeof folder.id !== "number" || !folder.path) continue;
    options.push({
      id: folder.id,
      path: folder.path,
      freeSpace: typeof folder.freeSpace === "number" ? folder.freeSpace : null,
    });
  }
  options.sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true }));
  return options;
}

/** Root folders Radarr can add movies to, as dropdown options. */
export async function listRootFolders(): Promise<RootFolderOption[]> {
  const client = radarrClient();
  const folders = await getList("Radarr root folder", (signal) => client.GET("/api/v3/rootfolder", { signal }));
  return toRootFolderOptions(folders);
}

/**
 * Pure: the body for POST /api/v3/movie. Only these fields are sent. minimumAvailability is set
 * explicitly because Radarr's own default is "tba". `year` is left out when unknown.
 */
export function movieAddBody(add: MovieAdd, title: string, year: number | null): MovieResource {
  const body: MovieResource = {
    tmdbId: add.tmdbId,
    title,
    qualityProfileId: add.qualityProfileId,
    rootFolderPath: add.rootFolderPath,
    monitored: add.monitored,
    minimumAvailability: "released",
    addOptions: {
      monitor: add.monitored ? "movieOnly" : "none",
      searchForMovie: add.searchForMovie,
      addMethod: "manual",
    },
  };
  if (year !== null) body.year = year;
  return body;
}

/**
 * Adds one movie to Radarr. Looks the id up again so the title and year come from Radarr, not from
 * the browser. Refuses a movie that is already in the library.
 */
export async function addMovie(add: MovieAdd): Promise<{ title: string; year: number | null }> {
  const client = radarrClient();

  const found = await arrRequest("Radarr movie lookup", (signal) =>
    client.GET("/api/v3/movie/lookup/tmdb", { params: { query: { tmdbId: add.tmdbId } }, signal }),
  );
  if (typeof found?.title !== "string" || found.title.trim() === "") throw new MovieAddError("not-found");
  const title = found.title;
  const year = yearOrNull(found.year);

  const existing = await getList("Radarr movie", (signal) =>
    client.GET("/api/v3/movie", { params: { query: { tmdbId: add.tmdbId } }, signal }),
  );
  if (existing.length > 0) throw new MovieAddError("exists");

  const body = movieAddBody(add, title, year);
  await arrRequest("Radarr movie add", (signal) => client.POST("/api/v3/movie", { body, signal }));

  return { title, year };
}

// Fake Radarr, Sonarr and Plex Media Server for the demo stack. Plain node:http, one process, three ports.
//
// Each server answers only the paths MediaHub calls (the list is in the routes below, checked against src/server).
// Replies copy the field names of the generated Radarr and Sonarr types and the fixtures in src/server/*/__fixtures__.
// Unknown paths get a 404 and a log line that names the path, so a missing endpoint is easy to spot.
//
// The Arr servers keep a mutable copy of the catalogue, so adds, edits, deletes and monitor changes made in MediaHub
// show up on the next read, as they would with a real Radarr or Sonarr. The Plex server is read-only.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { artCacheDir, backdropSvg, cachedJpeg, posterSvg } from "./art";
import {
  isoTime,
  radarrReleases,
  seasonRowsFor,
  seriesStatisticsFor,
  searchTitles,
  sonarrReleases,
  type Catalogue,
  type EpisodeResource,
  type MovieResource,
  type RadarrHistoryRecord,
  type RadarrQueueItem,
  type SeriesResource,
  type SonarrHistoryRecord,
  type SonarrQueueItem,
} from "./catalogue";
import { DEMO_API_KEY, DEMO_PLEX_SERVER, DEMO_PLEX_TOKEN, DEMO_PORTS } from "./config";

export type FakePorts = { radarr: number; sonarr: number; plex: number };

export type StartFakeServersOptions = {
  catalogue: Catalogue;
  /** Port 0 asks the OS for a free port. The bound ports come back in the result. */
  ports?: Partial<FakePorts>;
  apiKey?: string;
  plexToken?: string;
  /** Where cached JPEG renders go. Defaults to demo/art. Tests pass a temporary folder. */
  artDir?: string;
  log?: (line: string) => void;
};

export type FakeServers = { ports: FakePorts; close: () => Promise<void> };

type Reply = { status: number; body?: unknown; jpeg?: Buffer };
type Ctx = { method: string; params: Record<string, string>; query: URLSearchParams; body: unknown };
type Handler = (ctx: Ctx) => Promise<Reply> | Reply;
type Route = { method: string; pattern: RegExp; names: string[]; handler: Handler };

function route(method: string, routePath: string, handler: Handler): Route {
  const names: string[] = [];
  const source = routePath.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { method, pattern: new RegExp(`^${source}$`), names, handler };
}

const ok = (body?: unknown): Reply => ({ status: 200, body: body ?? {} });
const accepted = (body?: unknown): Reply => ({ status: 202, body: body ?? {} });
const created = (body: unknown): Reply => ({ status: 201, body });
const notFound = (): Reply => ({ status: 404, body: { message: "Not Found" } });
const badRequest = (message: string): Reply => ({ status: 400, body: [{ errorMessage: message }] });

/** Reads a JSON body, or returns undefined when there is none or it is not JSON. */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "") return resolve(undefined);
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

function sendReply(res: ServerResponse, reply: Reply): void {
  if (reply.jpeg) {
    res.writeHead(reply.status, { "content-type": "image/jpeg", "content-length": reply.jpeg.length });
    res.end(reply.jpeg);
    return;
  }
  const text = JSON.stringify(reply.body ?? {});
  res.writeHead(reply.status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/** Radarr's and Sonarr's history event codes, from their MovieHistoryEventType and EpisodeHistoryEventType enums. */
const RADARR_EVENT_CODES: Record<string, number> = {
  unknown: 0,
  grabbed: 1,
  downloadFolderImported: 3,
  downloadFailed: 4,
  movieFolderImported: 7,
  movieFileDeleted: 6,
  movieFileRenamed: 8,
  downloadIgnored: 9,
};
const SONARR_EVENT_CODES: Record<string, number> = {
  unknown: 0,
  grabbed: 1,
  seriesFolderImported: 2,
  downloadFolderImported: 3,
  downloadFailed: 4,
  episodeFileDeleted: 5,
  episodeFileRenamed: 6,
  downloadIgnored: 7,
};

/** The integer event codes in a query. Accepts repeated `eventType=1&eventType=3` and comma lists. */
function eventCodesOf(query: URLSearchParams): number[] {
  return query
    .getAll("eventType")
    .flatMap((value) => value.split(","))
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
}

/** One page of history, newest first, the shape of Radarr's and Sonarr's paged history reply. */
function historyPage<T extends { date?: string; eventType?: string | null }>(
  records: T[],
  codes: Record<string, number>,
  query: URLSearchParams,
): Reply {
  const wanted = eventCodesOf(query);
  const filtered = records
    .filter((record) => wanted.length === 0 || wanted.includes(codes[record.eventType ?? "unknown"] ?? 0))
    .sort((a, b) => Date.parse(b.date ?? "") - Date.parse(a.date ?? ""));
  const page = Math.max(1, Number(query.get("page") ?? "1"));
  const pageSize = Math.max(1, Number(query.get("pageSize") ?? "20"));
  return ok({
    page,
    pageSize,
    sortKey: "date",
    sortDirection: "descending",
    totalRecords: filtered.length,
    records: filtered.slice((page - 1) * pageSize, page * pageSize),
  });
}

/** The ISO date range from a calendar query, as milliseconds. A missing bound is open. */
function rangeOf(query: URLSearchParams): { start: number; end: number } {
  const start = Date.parse(query.get("start") ?? "") || -Infinity;
  const end = Date.parse(query.get("end") ?? "") || Infinity;
  return { start, end };
}

const inRange = (value: string | null | undefined, range: { start: number; end: number }): boolean => {
  if (!value) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= range.start && ms <= range.end;
};

// Images are rendered once per process and kept in memory, on top of the disk cache in cachedJpeg.
function imageRoutes(kind: "movie" | "series", artDir: string, memory: Map<string, Buffer>, lookup: (id: number) => { title: string; year: number | null } | undefined): Route {
  return route("GET", "/api/v3/mediacover/:id/:file", async ({ params }) => {
    const id = Number(params.id);
    const file = params.file;
    const isPoster = file === "poster-250.jpg" || file === "poster.jpg";
    const isBackdrop = file === "fanart.jpg";
    if (!isPoster && !isBackdrop) return notFound();
    const item = lookup(id);
    if (!item) return notFound();
    const svg = isPoster ? posterSvg(item.title, item.year, id) : backdropSvg(item.title, id);
    const key = `${kind}:${id}:${isPoster ? "poster" : "backdrop"}`;
    let jpeg = memory.get(key);
    if (!jpeg) {
      jpeg = await cachedJpeg(svg, artDir);
      memory.set(key, jpeg);
    }
    return { status: 200, jpeg };
  });
}

function radarrRoutes(catalogue: Catalogue, artDir: string, images: Map<string, Buffer>, now: number): Route[] {
  // Movies, lookups and queue live in state. Each list is copied once from the catalogue.
  const movies: MovieResource[] = structuredClone(catalogue.radarr.movies);
  const lookupMovies: MovieResource[] = structuredClone(catalogue.radarr.lookupMovies);
  const queue: RadarrQueueItem[] = structuredClone(catalogue.radarr.queue);
  const history: RadarrHistoryRecord[] = structuredClone(catalogue.radarr.history);
  let nextMovieId = movies.reduce((max, movie) => Math.max(max, movie.id ?? 0), 0) + 1;
  let nextHistoryId = history.reduce((max, record) => Math.max(max, record.id ?? 0), 0) + 1;

  const movieById = (id: number) => movies.find((movie) => movie.id === id);
  const movieLookup = (id: number) => {
    const movie = movieById(id);
    return movie ? { title: movie.title ?? "", year: movie.year ?? null } : undefined;
  };

  return [
    route("GET", "/api/v3/system/status", () => ok({ appName: "Radarr", version: "5.20.0.0-demo", instanceName: "Radarr (demo)", isDocker: false })),
    route("GET", "/api/v3/movie", ({ query }) => {
      const tmdbId = query.get("tmdbId");
      return ok(tmdbId === null ? movies : movies.filter((movie) => String(movie.tmdbId) === tmdbId));
    }),
    route("POST", "/api/v3/movie", ({ body }) => {
      const input = (body ?? {}) as { tmdbId?: number; monitored?: boolean; qualityProfileId?: number; rootFolderPath?: string; minimumAvailability?: string };
      if (movies.some((movie) => movie.tmdbId === input.tmdbId)) return badRequest("This movie has already been added");
      const found = lookupMovies.find((movie) => movie.tmdbId === input.tmdbId);
      if (!found) return badRequest("Movie not found");
      const movie: MovieResource = {
        ...found,
        id: nextMovieId++,
        monitored: input.monitored ?? true,
        qualityProfileId: input.qualityProfileId ?? 1,
        rootFolderPath: input.rootFolderPath ?? "/media/movies",
        minimumAvailability: (input.minimumAvailability ?? "released") as MovieResource["minimumAvailability"],
        hasFile: false,
        isAvailable: true,
        added: isoTime(now),
      };
      movies.push(movie);
      return created(movie);
    }),
    route("PUT", "/api/v3/movie/editor", ({ body }) => {
      const input = (body ?? {}) as { movieIds?: number[]; qualityProfileId?: number; monitored?: boolean; minimumAvailability?: string };
      const updated: MovieResource[] = [];
      for (const id of input.movieIds ?? []) {
        const movie = movieById(id);
        if (!movie) continue;
        if (input.qualityProfileId !== undefined) movie.qualityProfileId = input.qualityProfileId;
        if (input.monitored !== undefined) movie.monitored = input.monitored;
        if (input.minimumAvailability !== undefined) movie.minimumAvailability = input.minimumAvailability as MovieResource["minimumAvailability"];
        updated.push(movie);
      }
      return accepted(updated);
    }),
    route("DELETE", "/api/v3/movie/editor", ({ body }) => {
      const input = (body ?? {}) as { movieIds?: number[] };
      const ids = new Set(input.movieIds ?? []);
      for (let i = movies.length - 1; i >= 0; i--) if (ids.has(movies[i].id ?? -1)) movies.splice(i, 1);
      return ok();
    }),
    route("GET", "/api/v3/movie/lookup", ({ query }) => {
      const term = query.get("term") ?? "";
      const libraryTmdb = new Map(movies.map((movie) => [movie.tmdbId, movie]));
      // Lookup hits carry the library id for a movie already in the library, so the Add dialog can mark it.
      // Titles not in the library first, so a search shows Add buttons above the "In library" rows.
      const hits = [...lookupMovies, ...movies].filter((movie) => searchTitles([movie], term).length > 0);
      return ok(hits.slice(0, 20).map((movie) => ({ ...movie, id: libraryTmdb.get(movie.tmdbId)?.id ?? 0 })));
    }),
    route("GET", "/api/v3/movie/lookup/tmdb", ({ query }) => {
      const tmdbId = Number(query.get("tmdbId"));
      const found = movies.find((movie) => movie.tmdbId === tmdbId) ?? lookupMovies.find((movie) => movie.tmdbId === tmdbId);
      return found ? ok({ ...found, id: 0 }) : notFound();
    }),
    route("GET", "/api/v3/movie/:id", ({ params }) => {
      const movie = movieById(Number(params.id));
      return movie ? ok(movie) : notFound();
    }),
    route("GET", "/api/v3/qualityprofile", () => ok(catalogue.radarr.profiles)),
    route("GET", "/api/v3/rootfolder", () => ok(catalogue.radarr.rootFolders)),
    route("GET", "/api/v3/queue/details", () => ok(queue)),
    route("DELETE", "/api/v3/queue/bulk", ({ body }) => {
      const ids = new Set(((body ?? {}) as { ids?: number[] }).ids ?? []);
      for (let i = queue.length - 1; i >= 0; i--) if (ids.has(queue[i].id ?? -1)) queue.splice(i, 1);
      return ok();
    }),
    route("GET", "/api/v3/calendar", ({ query }) => {
      const range = rangeOf(query);
      const unmonitored = query.get("unmonitored") === "true";
      return ok(
        movies.filter(
          (movie) =>
            (unmonitored || movie.monitored === true) &&
            (inRange(movie.inCinemas, range) || inRange(movie.digitalRelease, range) || inRange(movie.physicalRelease, range)),
        ),
      );
    }),
    route("GET", "/api/v3/history", ({ query }) => historyPage(history, RADARR_EVENT_CODES, query)),
    route("POST", "/api/v3/history/failed/:id", ({ params }) => {
      const source = history.find((record) => record.id === Number(params.id));
      if (!source) return notFound();
      history.push({ ...source, id: nextHistoryId++, eventType: "downloadFailed", date: isoTime(now) } as RadarrHistoryRecord);
      return ok();
    }),
    route("GET", "/api/v3/credit", ({ query }) => {
      const movie = movieById(Number(query.get("movieId")));
      return ok(movie?.tmdbId === undefined ? [] : (catalogue.radarr.creditsByTmdbId[movie.tmdbId] ?? []));
    }),
    route("GET", "/api/v3/release", ({ query }) => {
      const movie = movieById(Number(query.get("movieId")));
      return movie ? ok(radarrReleases(movie)) : notFound();
    }),
    route("POST", "/api/v3/release", () => ok()),
    route("POST", "/api/v3/command", ({ body }) => {
      const name = String(((body ?? {}) as { name?: unknown }).name ?? "");
      return created({ id: 1, name, commandName: name, status: "queued", queued: isoTime(now), trigger: "manual" });
    }),
    route("GET", "/api/v3/manualimport", ({ query }) => {
      const downloadId = query.get("downloadId");
      const item = queue.find((row) => row.downloadId === downloadId);
      if (!item || !item.movie) return ok([]);
      return ok([
        {
          path: `${item.outputPath ?? "/downloads/demo"}/${item.title ?? "download"}.mkv`,
          relativePath: `${item.title ?? "download"}.mkv`,
          folderName: "demo",
          name: item.title ?? "download",
          size: item.size ?? 0,
          movie: { id: item.movie.id, title: item.movie.title, year: item.movie.year },
          movieId: item.movieId,
          movieFileId: null,
          quality: item.quality,
          languages: [{ id: 1, name: "English" }],
          releaseGroup: "DEMO",
          qualityWeight: 7,
          downloadId,
          customFormats: [],
          customFormatScore: 0,
          indexerFlags: 0,
          rejections: [],
        },
      ]);
    }),
    imageRoutes("movie", artDir, images, movieLookup),
  ];
}

function sonarrRoutes(catalogue: Catalogue, artDir: string, images: Map<string, Buffer>, now: number): Route[] {
  const series: SeriesResource[] = structuredClone(catalogue.sonarr.series);
  const episodes: EpisodeResource[] = structuredClone(catalogue.sonarr.episodes);
  const lookupSeries: SeriesResource[] = structuredClone(catalogue.sonarr.lookupSeries);
  const lookupEpisodes: Record<number, EpisodeResource[]> = structuredClone(catalogue.sonarr.lookupEpisodesByTvdbId);
  const queue: SonarrQueueItem[] = structuredClone(catalogue.sonarr.queue);
  const history: SonarrHistoryRecord[] = structuredClone(catalogue.sonarr.history);
  let nextSeriesId = series.reduce((max, show) => Math.max(max, show.id ?? 0), 0) + 1;
  let nextEpisodeId = episodes.reduce((max, episode) => Math.max(max, episode.id ?? 0), 0) + 1;
  let nextHistoryId = history.reduce((max, record) => Math.max(max, record.id ?? 0), 0) + 1;

  const seriesById = (id: number) => series.find((show) => show.id === id);
  const seriesLookup = (id: number) => {
    const show = seriesById(id);
    return show ? { title: show.title ?? "", year: show.year ?? null } : undefined;
  };

  /** Applies a season's monitored flag to its episodes. */
  function applySeasonMonitored(showId: number, seasonNumber: number, monitored: boolean) {
    for (const episode of episodes) {
      if (episode.seriesId === showId && episode.seasonNumber === seasonNumber) episode.monitored = monitored;
    }
  }

  return [
    route("GET", "/api/v3/system/status", () => ok({ appName: "Sonarr", version: "4.0.0.0-demo", instanceName: "Sonarr (demo)", isDocker: false })),
    route("GET", "/api/v3/series", ({ query }) => {
      const tvdbId = query.get("tvdbId");
      return ok(tvdbId === null ? series : series.filter((show) => String(show.tvdbId) === tvdbId));
    }),
    route("GET", "/api/v3/series/lookup", ({ query }) => {
      const term = query.get("term") ?? "";
      // Titles not in the library first, as for movies.
      const pool = [...lookupSeries, ...series];
      const hits = term.startsWith("tvdb:")
        ? pool.filter((show) => String(show.tvdbId) === term.slice("tvdb:".length))
        : searchTitles(pool, term);
      return ok(hits.slice(0, 20));
    }),
    route("POST", "/api/v3/series", ({ body }) => {
      const input = (body ?? {}) as {
        tvdbId?: number;
        qualityProfileId?: number;
        rootFolderPath?: string;
        seriesType?: SeriesResource["seriesType"];
        seasonFolder?: boolean;
        monitored?: boolean;
        addOptions?: { monitor?: string };
      };
      if (series.some((show) => show.tvdbId === input.tvdbId)) return badRequest("This series has already been added");
      const found = lookupSeries.find((show) => show.tvdbId === input.tvdbId);
      if (!found || input.tvdbId === undefined) return badRequest("Series not found");
      const id = nextSeriesId++;
      const monitored = input.monitored ?? true;
      const newEpisodes = (lookupEpisodes[input.tvdbId] ?? []).map((episode) => ({
        ...episode,
        id: nextEpisodeId++,
        seriesId: id,
        monitored: monitored && episode.monitored !== false,
        hasFile: false,
        episodeFile: undefined,
      }));
      episodes.push(...newEpisodes);
      const seasons = seasonRowsFor(newEpisodes, now, () => monitored);
      const show: SeriesResource = {
        ...found,
        id,
        monitored,
        qualityProfileId: input.qualityProfileId ?? 1,
        rootFolderPath: input.rootFolderPath ?? "/media/tv",
        seriesType: input.seriesType ?? "standard",
        seasonFolder: input.seasonFolder ?? true,
        added: isoTime(now),
        seasons,
        statistics: seriesStatisticsFor(newEpisodes, seasons.length, now),
      };
      series.push(show);
      return created(show);
    }),
    route("PUT", "/api/v3/series/editor", ({ body }) => {
      const input = (body ?? {}) as Partial<SeriesResource> & { seriesIds?: number[] };
      const updated: SeriesResource[] = [];
      for (const id of input.seriesIds ?? []) {
        const show = seriesById(id);
        if (!show) continue;
        if (input.qualityProfileId !== undefined) show.qualityProfileId = input.qualityProfileId;
        if (input.monitored !== undefined) show.monitored = input.monitored;
        if (input.seriesType !== undefined) show.seriesType = input.seriesType;
        if (input.seasonFolder !== undefined) show.seasonFolder = input.seasonFolder;
        if (input.monitorNewItems !== undefined) show.monitorNewItems = input.monitorNewItems;
        updated.push(show);
      }
      return accepted(updated);
    }),
    route("DELETE", "/api/v3/series/editor", ({ body }) => {
      const ids = new Set(((body ?? {}) as { seriesIds?: number[] }).seriesIds ?? []);
      for (let i = series.length - 1; i >= 0; i--) if (ids.has(series[i].id ?? -1)) series.splice(i, 1);
      for (let i = episodes.length - 1; i >= 0; i--) if (ids.has(episodes[i].seriesId ?? -1)) episodes.splice(i, 1);
      return ok();
    }),
    route("PUT", "/api/v3/series/:id", ({ params, body }) => {
      const id = Number(params.id);
      const show = seriesById(id);
      const input = body as SeriesResource | undefined;
      if (!show || !input) return notFound();
      // Season flags in the body apply to their episodes. Other fields are taken from the body.
      for (const season of input.seasons ?? []) {
        const before = show.seasons?.find((row) => row.seasonNumber === season.seasonNumber);
        if (before && before.monitored !== season.monitored) applySeasonMonitored(id, season.seasonNumber ?? 0, season.monitored === true);
      }
      show.monitored = input.monitored ?? show.monitored;
      show.seasons = input.seasons ?? show.seasons;
      return accepted(show);
    }),
    route("GET", "/api/v3/series/:id", ({ params }) => {
      const show = seriesById(Number(params.id));
      return show ? ok(show) : notFound();
    }),
    route("GET", "/api/v3/episode", ({ query }) => {
      const seriesId = Number(query.get("seriesId"));
      return ok(episodes.filter((episode) => episode.seriesId === seriesId));
    }),
    route("PUT", "/api/v3/episode/monitor", ({ body }) => {
      const input = (body ?? {}) as { episodeIds?: number[]; monitored?: boolean };
      const ids = new Set(input.episodeIds ?? []);
      const updated: EpisodeResource[] = [];
      for (const episode of episodes) {
        if (!ids.has(episode.id ?? -1)) continue;
        episode.monitored = input.monitored === true;
        updated.push(episode);
      }
      return accepted(updated);
    }),
    route("GET", "/api/v3/qualityprofile", () => ok(catalogue.sonarr.profiles)),
    route("GET", "/api/v3/rootfolder", () => ok(catalogue.sonarr.rootFolders)),
    route("GET", "/api/v3/queue/details", ({ query }) => {
      const seriesId = query.get("seriesId");
      return ok(seriesId === null ? queue : queue.filter((row) => String(row.seriesId) === seriesId));
    }),
    route("DELETE", "/api/v3/queue/bulk", ({ body }) => {
      const ids = new Set(((body ?? {}) as { ids?: number[] }).ids ?? []);
      for (let i = queue.length - 1; i >= 0; i--) if (ids.has(queue[i].id ?? -1)) queue.splice(i, 1);
      return ok();
    }),
    route("GET", "/api/v3/calendar", ({ query }) => {
      const range = rangeOf(query);
      const unmonitored = query.get("unmonitored") === "true";
      const includeSeries = query.get("includeSeries") === "true";
      const rows = episodes.filter((episode) => (unmonitored || episode.monitored === true) && inRange(episode.airDateUtc, range));
      return ok(rows.map((episode) => (includeSeries ? { ...episode, series: seriesById(episode.seriesId ?? -1) } : episode)));
    }),
    route("GET", "/api/v3/history", ({ query }) => historyPage(history, SONARR_EVENT_CODES, query)),
    route("POST", "/api/v3/history/failed/:id", ({ params }) => {
      const source = history.find((record) => record.id === Number(params.id));
      if (!source) return notFound();
      history.push({ ...source, id: nextHistoryId++, eventType: "downloadFailed", date: isoTime(now) } as SonarrHistoryRecord);
      return ok();
    }),
    route("GET", "/api/v3/release", ({ query }) => {
      const episodeId = query.get("episodeId");
      if (episodeId !== null) {
        const episode = episodes.find((row) => row.id === Number(episodeId));
        const show = episode ? seriesById(episode.seriesId ?? -1) : undefined;
        if (!episode || !show) return notFound();
        return ok(sonarrReleases(show, episode.seasonNumber ?? 0, [episode.episodeNumber ?? 1], false));
      }
      const show = seriesById(Number(query.get("seriesId")));
      if (!show) return notFound();
      const seasonNumber = Number(query.get("seasonNumber"));
      const numbers = episodes
        .filter((row) => row.seriesId === show.id && row.seasonNumber === seasonNumber)
        .map((row) => row.episodeNumber ?? 0);
      return ok(sonarrReleases(show, seasonNumber, numbers, true));
    }),
    route("POST", "/api/v3/release", () => ok()),
    route("POST", "/api/v3/command", ({ body }) => {
      const name = String(((body ?? {}) as { name?: unknown }).name ?? "");
      return created({ id: 1, name, commandName: name, status: "queued", queued: isoTime(now), trigger: "manual" });
    }),
    route("GET", "/api/v3/manualimport", ({ query }) => {
      const downloadId = query.get("downloadId");
      const item = queue.find((row) => row.downloadId === downloadId);
      if (!item || !item.series) return ok([]);
      return ok([
        {
          path: `${item.outputPath ?? "/downloads/demo"}/${item.title ?? "download"}.mkv`,
          relativePath: `Season ${item.seasonNumber ?? 1}/${item.title ?? "download"}.mkv`,
          folderName: "demo",
          name: item.title ?? "download",
          size: item.size ?? 0,
          series: { id: item.series.id, title: item.series.title },
          seriesId: item.seriesId,
          seasonNumber: item.seasonNumber,
          episodes: item.episode ? [{ id: item.episode.id, seasonNumber: item.episode.seasonNumber, episodeNumber: item.episode.episodeNumber, title: item.episode.title }] : [],
          episodeIds: item.episodeId ? [item.episodeId] : [],
          episodeFileId: null,
          quality: item.quality,
          languages: [{ id: 1, name: "English" }],
          releaseGroup: "DEMO",
          qualityWeight: 3,
          downloadId,
          customFormats: [],
          customFormatScore: 0,
          indexerFlags: 0,
          releaseType: "singleEpisode",
          rejections: [],
        },
      ]);
    }),
    imageRoutes("series", artDir, images, seriesLookup),
  ];
}

/** Plex's reply shape for the library and episode calls MediaHub makes (see src/server/plex/server.ts). */
function plexRoutes(catalogue: Catalogue): Route[] {
  const { plex } = catalogue;
  return [
    route("GET", "/identity", () =>
      ok({ MediaContainer: { machineIdentifier: DEMO_PLEX_SERVER.id, friendlyName: DEMO_PLEX_SERVER.name, version: "1.00.0.0000-demo", size: 0 } }),
    ),
    route("GET", "/library/sections", () =>
      ok({
        MediaContainer: {
          size: plex.sections.length,
          Directory: plex.sections.map((section) => ({ key: section.key, type: section.type, title: section.title, agent: "demo", scanner: "demo" })),
        },
      }),
    ),
    route("GET", "/library/sections/:key/all", ({ params }) => {
      if (params.key === plex.sections.find((section) => section.type === "movie")?.key) {
        const Metadata = plex.movies.map((movie) => ({
          ratingKey: movie.ratingKey,
          key: `/library/metadata/${movie.ratingKey}`,
          type: "movie",
          title: movie.title,
          Guid: movie.guids.map((id) => ({ id })),
          viewCount: movie.viewCount,
          viewOffset: movie.viewOffset,
        }));
        return ok({ MediaContainer: { size: Metadata.length, Metadata } });
      }
      if (params.key === plex.sections.find((section) => section.type === "show")?.key) {
        const Metadata = plex.shows.map((show) => ({
          ratingKey: show.ratingKey,
          key: `/library/metadata/${show.ratingKey}`,
          type: "show",
          title: show.title,
          Guid: show.guids.map((id) => ({ id })),
          leafCount: show.leafCount,
          viewedLeafCount: show.viewedLeafCount,
        }));
        return ok({ MediaContainer: { size: Metadata.length, Metadata } });
      }
      return notFound();
    }),
    route("GET", "/library/metadata/:key/allLeaves", ({ params }) => {
      const episodes = plex.episodesByShowKey[params.key];
      if (!episodes) return notFound();
      const Metadata = episodes.map((episode) => ({
        ratingKey: episode.ratingKey,
        key: `/library/metadata/${episode.ratingKey}`,
        type: "episode",
        title: episode.title,
        parentIndex: episode.parentIndex,
        index: episode.index,
        Guid: episode.guids.map((id) => ({ id })),
        viewCount: episode.viewCount,
        viewOffset: episode.viewOffset,
      }));
      return ok({ MediaContainer: { size: Metadata.length, Metadata } });
    }),
  ];
}

/** Finds the route for a method and path, or undefined. The path has no query string. */
function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | undefined {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const match = candidate.pattern.exec(pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    candidate.names.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]);
    });
    return { route: candidate, params };
  }
  return undefined;
}

/** matchRoute, but a path with a broken %-escape gives "bad" instead of throwing and taking the fakes down. */
function safeMatch(routes: Route[], method: string, pathname: string): ReturnType<typeof matchRoute> | "bad" {
  try {
    return matchRoute(routes, method, pathname);
  } catch {
    return "bad";
  }
}

/**
 * One app server. The API key or Plex token is checked before anything else, and a failure is a 401 with no route
 * lookup. Log lines name the method and the path only, never the query string or the key.
 */
function appServer(name: string, routes: Route[], check: (req: IncomingMessage) => boolean, log: (line: string) => void): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!check(req)) {
      sendReply(res, { status: 401, body: { message: "Unauthorized" } });
      return;
    }
    const body = await readBody(req);
    const method = (req.method ?? "GET").toUpperCase();
    const found = safeMatch(routes, method, url.pathname);
    if (found === "bad") {
      sendReply(res, { status: 400, body: { message: "Bad path" } });
      return;
    }
    if (!found) {
      log(`[fake ${name}] 404 ${method} ${url.pathname}`);
      sendReply(res, notFound());
      return;
    }
    try {
      const reply = await found.route.handler({ method, params: found.params, query: url.searchParams, body });
      sendReply(res, reply);
    } catch (error) {
      log(`[fake ${name}] 500 ${method} ${url.pathname}: ${error instanceof Error ? error.message : "error"}`);
      sendReply(res, { status: 500, body: { message: "Fake server error" } });
    }
  });
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });
}

/**
 * Starts the fake Radarr, Sonarr and Plex servers on 127.0.0.1. Each Arr server answers only to the demo API key, and
 * the Plex server only to the demo Plex token. Returns the bound ports and a close function that waits for the sockets.
 */
export async function startFakeServers(options: StartFakeServersOptions): Promise<FakeServers> {
  const { catalogue } = options;
  const apiKey = options.apiKey ?? DEMO_API_KEY;
  const plexToken = options.plexToken ?? DEMO_PLEX_TOKEN;
  const artDir = options.artDir ?? artCacheDir();
  const log = options.log ?? ((line: string) => console.log(line));
  const now = catalogue.now;
  const images = new Map<string, Buffer>();

  const hasKey = (req: IncomingMessage) => req.headers["x-api-key"] === apiKey;
  const hasToken = (req: IncomingMessage) => req.headers["x-plex-token"] === plexToken;

  // Plex's /identity needs no token, so MediaHub can check the server before it sends the token (see plex/watched.ts).
  const plexRouteList = plexRoutes(catalogue);
  const plexServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = (req.method ?? "GET").toUpperCase();
    const isIdentity = url.pathname === "/identity";
    if (!isIdentity && !hasToken(req)) {
      sendReply(res, { status: 401, body: { error: "unauthorized" } });
      return;
    }
    const found = safeMatch(plexRouteList, method, url.pathname);
    if (found === "bad") {
      sendReply(res, { status: 400, body: { error: "bad path" } });
      return;
    }
    if (!found) {
      log(`[fake plex] 404 ${method} ${url.pathname}`);
      sendReply(res, notFound());
      return;
    }
    try {
      sendReply(res, await found.route.handler({ method, params: found.params, query: url.searchParams, body: undefined }));
    } catch (error) {
      log(`[fake plex] 500 ${method} ${url.pathname}: ${error instanceof Error ? error.message : "error"}`);
      sendReply(res, { status: 500, body: { error: "fake server error" } });
    }
  });

  const radarrServer = appServer("radarr", radarrRoutes(catalogue, artDir, images, now), hasKey, log);
  const sonarrServer = appServer("sonarr", sonarrRoutes(catalogue, artDir, images, now), hasKey, log);

  const ports: FakePorts = {
    radarr: await listen(radarrServer, options.ports?.radarr ?? DEMO_PORTS.radarr),
    sonarr: await listen(sonarrServer, options.ports?.sonarr ?? DEMO_PORTS.sonarr),
    plex: await listen(plexServer, options.ports?.plex ?? DEMO_PORTS.plex),
  };

  const servers = [radarrServer, sonarrServer, plexServer];
  return {
    ports,
    close: () =>
      new Promise<void>((resolve) => {
        let remaining = servers.length;
        for (const server of servers) {
          server.closeAllConnections();
          server.close(() => {
            remaining -= 1;
            if (remaining === 0) resolve();
          });
        }
      }),
  };
}

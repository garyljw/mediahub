import { describe, expect, it } from "vitest";
import { buildCatalogue } from "../../../scripts/demo/catalogue";

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const DAY = 86_400_000;

describe("buildCatalogue", () => {
  it("gives the same output for the same now", () => {
    expect(JSON.stringify(buildCatalogue(NOW))).toBe(JSON.stringify(buildCatalogue(NOW)));
  });

  it("has the planned counts", () => {
    const catalogue = buildCatalogue(NOW);
    expect(catalogue.radarr.movies).toHaveLength(60);
    expect(catalogue.radarr.lookupMovies).toHaveLength(8);
    expect(catalogue.sonarr.series).toHaveLength(20);
    expect(catalogue.sonarr.lookupSeries).toHaveLength(3);
    expect(catalogue.radarr.profiles.map((profile) => profile.name)).toEqual(["HD-1080p", "Ultra-HD"]);
    expect(catalogue.sonarr.profiles.map((profile) => profile.name)).toEqual(["HD-1080p", "Ultra-HD"]);
    expect(catalogue.radarr.rootFolders.map((folder) => folder.path)).toEqual(["/media/movies"]);
    expect(catalogue.sonarr.rootFolders.map((folder) => folder.path)).toEqual(["/media/tv"]);
  });

  it("gives every movie, series and episode a unique id", () => {
    const catalogue = buildCatalogue(NOW);
    const movieIds = catalogue.radarr.movies.map((movie) => movie.id);
    const seriesIds = catalogue.sonarr.series.map((show) => show.id);
    const episodeIds = catalogue.sonarr.episodes.map((episode) => episode.id);
    expect(new Set(movieIds).size).toBe(movieIds.length);
    expect(new Set(seriesIds).size).toBe(seriesIds.length);
    expect(new Set(episodeIds).size).toBe(episodeIds.length);
  });

  it("uses unique titles", () => {
    const catalogue = buildCatalogue(NOW);
    const titles = [
      ...catalogue.radarr.movies.map((movie) => movie.title),
      ...catalogue.sonarr.series.map((show) => show.title),
    ];
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("gives every episode a series that exists", () => {
    const catalogue = buildCatalogue(NOW);
    const seriesIds = new Set(catalogue.sonarr.series.map((show) => show.id));
    for (const episode of catalogue.sonarr.episodes) {
      expect(seriesIds.has(episode.seriesId)).toBe(true);
    }
  });

  it("has a realistic mix of movie states", () => {
    const { movies } = buildCatalogue(NOW).radarr;
    expect(movies.filter((movie) => movie.hasFile === true).length).toBeGreaterThan(30);
    expect(movies.filter((movie) => movie.hasFile !== true && movie.monitored === true && movie.isAvailable === true).length).toBeGreaterThan(3);
    expect(movies.filter((movie) => movie.monitored === false).length).toBeGreaterThan(0);
  });

  it("has series with full, partial and empty seasons", () => {
    const catalogue = buildCatalogue(NOW);
    const shows = catalogue.sonarr.series;
    const counts = shows.map((show) => {
      const episodes = catalogue.sonarr.episodes.filter((episode) => episode.seriesId === show.id);
      return episodes.filter((episode) => episode.hasFile === true).length / Math.max(1, episodes.length);
    });
    expect(counts.some((ratio) => ratio === 1)).toBe(true);
    expect(counts.some((ratio) => ratio > 0 && ratio < 1)).toBe(true);
    expect(counts.some((ratio) => ratio === 0)).toBe(true);
    // Some series have Specials (season 0), so the season numbers include zero.
    expect(catalogue.sonarr.series.some((show) => show.seasons?.some((season) => season.seasonNumber === 0))).toBe(true);
  });

  it("has 3 to 5 queue items across both apps, one paused and one import-blocked or import-pending", () => {
    const catalogue = buildCatalogue(NOW);
    const total = catalogue.radarr.queue.length + catalogue.sonarr.queue.length;
    expect(total).toBeGreaterThanOrEqual(3);
    expect(total).toBeLessThanOrEqual(5);
    expect(catalogue.radarr.queue.some((item) => item.status === "paused")).toBe(true);
    expect(catalogue.radarr.queue.some((item) => item.trackedDownloadState === "importBlocked")).toBe(true);
    expect(catalogue.sonarr.queue.some((item) => item.trackedDownloadState === "importPending")).toBe(true);
  });

  it("points every queue item at a library item", () => {
    const catalogue = buildCatalogue(NOW);
    const movieIds = new Set(catalogue.radarr.movies.map((movie) => movie.id));
    const seriesIds = new Set(catalogue.sonarr.series.map((show) => show.id));
    const episodeIds = new Set(catalogue.sonarr.episodes.map((episode) => episode.id));
    for (const item of catalogue.radarr.queue) expect(movieIds.has(item.movieId ?? -1)).toBe(true);
    for (const item of catalogue.sonarr.queue) {
      expect(seriesIds.has(item.seriesId ?? -1)).toBe(true);
      expect(episodeIds.has(item.episodeId ?? -1)).toBe(true);
    }
  });

  it("puts some calendar entries in the past 7 and next 21 days", () => {
    const catalogue = buildCatalogue(NOW);
    const inWindow = (value: string | null | undefined) => {
      if (!value) return false;
      const ms = Date.parse(value);
      return ms >= NOW - 7 * DAY && ms <= NOW + 21 * DAY;
    };
    const episodes = catalogue.sonarr.episodes.filter((episode) => inWindow(episode.airDateUtc));
    const movies = catalogue.radarr.movies.filter((movie) => inWindow(movie.digitalRelease));
    expect(episodes.length).toBeGreaterThan(0);
    expect(movies.length).toBeGreaterThan(0);
  });

  it("has 40 history records in the last 30 days", () => {
    const catalogue = buildCatalogue(NOW);
    expect(catalogue.radarr.history.length + catalogue.sonarr.history.length).toBe(40);
    const dates = [...catalogue.radarr.history, ...catalogue.sonarr.history].map((record) => Date.parse(record.date ?? ""));
    for (const ms of dates) {
      expect(ms).toBeGreaterThanOrEqual(NOW - 30 * DAY);
      expect(ms).toBeLessThanOrEqual(NOW);
    }
  });

  it("gives Plex entries for files that exist, with guids the watched index matches", () => {
    const catalogue = buildCatalogue(NOW);
    const tmdbIds = new Set(catalogue.radarr.movies.filter((movie) => movie.hasFile === true).map((movie) => movie.tmdbId));
    for (const entry of catalogue.plex.movies) {
      const tmdb = entry.guids.find((guid) => guid.startsWith("tmdb://"));
      expect(tmdb).toBeDefined();
      expect(tmdbIds.has(Number(tmdb?.slice("tmdb://".length)))).toBe(true);
    }
    const states = new Set<string>();
    for (const entry of catalogue.plex.movies) states.add(entry.viewCount > 0 ? "watched" : entry.viewOffset > 0 ? "partly" : "unwatched");
    expect(states).toEqual(new Set(["watched", "partly", "unwatched"]));
  });

  it("has invented lookup titles that are not in the library", () => {
    const catalogue = buildCatalogue(NOW);
    const libraryTmdb = new Set(catalogue.radarr.movies.map((movie) => movie.tmdbId));
    for (const hit of catalogue.radarr.lookupMovies) expect(libraryTmdb.has(hit.tmdbId)).toBe(false);
    const libraryTvdb = new Set(catalogue.sonarr.series.map((show) => show.tvdbId));
    for (const hit of catalogue.sonarr.lookupSeries) expect(libraryTvdb.has(hit.tvdbId)).toBe(false);
  });
});

import "server-only";
import { radarrClient, sonarrClient } from "./client";
import { getList } from "./request";
import { addDays } from "../merge/calendar-dates";
import type { components as RadarrComponents } from "./generated/radarr";
import type { components as SonarrComponents } from "./generated/sonarr";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];
type EpisodeResource = SonarrComponents["schemas"]["EpisodeResource"];

/**
 * Radarr movies with a release date (cinema, digital or physical) between from and to, both "YYYY-MM-DD" and
 * inclusive. Unmonitored movies are included, because the page filters them in the browser.
 */
export async function fetchMovieCalendar(from: string, to: string): Promise<MovieResource[]> {
  const client = radarrClient();
  return getList("Radarr calendar", (signal) =>
    client.GET("/api/v3/calendar", {
      params: { query: { start: `${from}T00:00:00Z`, end: `${to}T23:59:59Z`, unmonitored: true } },
      signal,
    }),
  );
}

/**
 * Sonarr episodes airing between from and to, with their series attached. Sonarr filters on airDateUtc, so the
 * window is widened by a day on each side. The caller drops episodes whose local airDate is outside [from, to].
 * Unmonitored episodes are included, because the page filters them in the browser.
 */
export async function fetchEpisodeCalendar(from: string, to: string): Promise<EpisodeResource[]> {
  const client = sonarrClient();
  const start = addDays(from, -1);
  const end = addDays(to, 1);
  return getList("Sonarr calendar", (signal) =>
    client.GET("/api/v3/calendar", {
      params: {
        query: {
          start: `${start}T00:00:00Z`,
          end: `${end}T23:59:59Z`,
          unmonitored: true,
          includeSeries: true,
        },
      },
      signal,
    }),
  );
}

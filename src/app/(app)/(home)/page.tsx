import { requirePageUser } from "@/server/authz";
import { listMovies } from "@/server/arr/movies";
import { listSeries } from "@/server/arr/series";
import { loadOrNull } from "@/server/arr/load-or-null";
import { getWatchedIndex } from "@/server/plex/watched";
import { getPlexDataConnection } from "@/server/plex/data-connection";
import { homeDownloadedByKey, homeWatched, toHomeItems } from "@/server/merge/library";
import { seriesDownloadedAt } from "@/server/arr/series-downloaded";
import { movieImportDates, seriesImportDates } from "@/server/arr/import-history";
import { getPlexAddedIndex } from "@/server/plex/added";
import { focusMembership } from "@/server/focus/focus";
import { syncFocusIfStale } from "@/server/focus/plex-sync";
import type { HomeDownloaded, HomeLibrary, HomeWatched } from "@/components/home/home-items";
import { HomeGrid } from "@/components/home/home-grid";

export const metadata = { title: "Home" };
// The page waits only for the role check. The toolbar renders at once; the tiles stream in when Radarr and Sonarr answer,
// and the watched status when Plex answers. loading.tsx shows a placeholder for the role check.
export const instant = false;

export default async function HomePage() {
  await requirePageUser("admin", "requester");
  // Puts Focus changes made in Plex back, and adds titles that have arrived in Plex. Runs after the response.
  syncFocusIfStale();

  // Nothing here is awaited. Radarr, Sonarr and Plex all start now, and the grid receives the promises. Plex is not
  // wrapped in loadOrNull: a failure comes back as "failed" and only costs the banners, not the grid.
  // Kept apart so the series download dates can start as soon as Sonarr answers, without waiting for Radarr.
  const movieList = loadOrNull(listMovies, "Home page");
  const seriesList = loadOrNull(listSeries, "Home page");
  const arr = Promise.all([movieList, seriesList]);
  const plex = getWatchedIndex();
  const focus = focusMembership();

  // Neither promise may reject: the catches give a fallback and log a fixed message, never the error's details.
  const library: Promise<HomeLibrary> = arr
    .then(([movies, series]) => ({
      items: toHomeItems(movies?.rows ?? [], series?.rows ?? [], null, focus),
      moviesFailed: movies === null,
      seriesFailed: series === null,
    }))
    .catch(() => {
      console.error("Home page: the library could not be built");
      return { items: [], moviesFailed: true, seriesFailed: true };
    });

  const watched: Promise<HomeWatched> = Promise.all([arr, plex])
    .then(([[movies, series], index]) => homeWatched(movies?.rows ?? [], series?.rows ?? [], index))
    .catch(() => {
      console.error("Home page: the watched status could not be built");
      return { state: "failed" } as const;
    });

  // The download dates: each title's import in Radarr's or Sonarr's history, with the file record's date (or one request per
  // series, from Sonarr's episode files) for a title with a file and no import. This is the slowest part, so it streams in
  // last. A failed list contributes nothing, since its own error already shows. A failed history or file lookup marks the
  // dates incomplete, and never fails the grid.
  const downloaded: Promise<HomeDownloaded> = Promise.all([movieList, seriesList])
    .then(async ([movies, series]): Promise<HomeDownloaded> => {
      const [movieImports, seriesImports, plexAdded] = await Promise.all([
        movies === null ? new Map<number, string>() : movieImportDates(),
        series === null ? new Map<number, string>() : seriesImportDates(),
        getPlexAddedIndex(),
      ]);
      const importedSeries = seriesImports === "failed" ? new Map<number, string>() : seriesImports;
      const plexSeries = plexAdded === null || plexAdded === "failed" ? new Map<number, string>() : plexAdded.series;
      // Only series with files that have neither an import nor a Plex date need their file date from Sonarr.
      const needFileDate = (series?.rows ?? []).filter(
        (row) =>
          row.episodeFileCount > 0 &&
          !importedSeries.has(row.id) &&
          !(row.tvdbId !== null && plexSeries.has(row.tvdbId)),
      );
      const fallback = await seriesDownloadedAt(needFileDate);
      return {
        state: "ready",
        byKey: homeDownloadedByKey(
          movies?.rows ?? [],
          series?.rows ?? [],
          movieImports,
          seriesImports,
          plexAdded,
          fallback.dates,
        ),
        incomplete: movieImports === "failed" || seriesImports === "failed" || plexAdded === "failed" || fallback.failed,
      };
    })
    .catch(() => {
      console.error("Home page: the download dates could not be built");
      return { state: "failed" } as const;
    });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
      <HomeGrid
        library={library}
        watched={watched}
        downloaded={downloaded}
        // Only whether a connection exists: the connection itself (with its token) stays on the server.
        plexConnected={getPlexDataConnection() !== null}
      />
    </div>
  );
}

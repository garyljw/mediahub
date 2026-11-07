import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePageUser } from "@/server/authz";
import { listMovies } from "@/server/arr/movies";
import { listSeries } from "@/server/arr/series";
import { loadOrNull } from "@/server/arr/load-or-null";
import { getWatchedIndex } from "@/server/plex/watched";
import { getPlexDataConnection } from "@/server/plex/data-connection";
import { homeWatched, toHomeItems } from "@/server/merge/library";
import { focusMembership } from "@/server/focus/focus";
import { syncFocusIfStale } from "@/server/focus/plex-sync";
import { Button } from "@/components/ui/button";
import type { HomeLibrary, HomeWatched } from "@/components/home/home-items";
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
  const arr = Promise.all([loadOrNull(listMovies, "Home page"), loadOrNull(listSeries, "Home page")]);
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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
      <HomeGrid
        library={library}
        watched={watched}
        // Only whether a connection exists: the connection itself (with its token) stays on the server.
        plexConnected={getPlexDataConnection() !== null}
        action={
          <Button asChild>
            <Link href="/add">
              <Plus aria-hidden />
              Add
            </Link>
          </Button>
        }
      />
    </div>
  );
}

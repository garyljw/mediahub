import Link from "next/link";
import { AlertTriangle, Plus } from "lucide-react";
import { requirePageUser } from "@/server/authz";
import { listMovies } from "@/server/arr/movies";
import { listSeries } from "@/server/arr/series";
import { loadOrNull } from "@/server/arr/load-or-null";
import { getWatchedIndex } from "@/server/plex/watched";
import { toHomeItems } from "@/server/merge/library";
import { focusMembership } from "@/server/focus/focus";
import { syncFocusIfStale } from "@/server/focus/plex-sync";
import { Button } from "@/components/ui/button";
import { HomeGrid } from "@/components/home/home-grid";

export const metadata = { title: "Home" };
// The page waits for Radarr, Sonarr and Plex before rendering; loading.tsx shows a placeholder meanwhile.
export const instant = false;

export default async function HomePage() {
  await requirePageUser("admin", "requester");
  // Puts Focus changes made in Plex back, and adds titles that have arrived in Plex. Runs after the response.
  syncFocusIfStale();

  // Plex is not wrapped in loadOrNull: a failure comes back as "failed" and only costs the banners, not the grid.
  const [movies, series, watched] = await Promise.all([
    loadOrNull(listMovies, "Home page"),
    loadOrNull(listSeries, "Home page"),
    getWatchedIndex(),
  ]);
  const watchedIndex = watched === "failed" ? null : watched;
  const focus = focusMembership();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
      {movies === null && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load movies from Radarr.
        </p>
      )}
      {series === null && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load TV from Sonarr.
        </p>
      )}
      {watched === "failed" && (
        <p role="status" className="inline-flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
          Couldn&apos;t load watched status from Plex.
        </p>
      )}
      {(movies !== null || series !== null) && (
        <HomeGrid
          items={toHomeItems(movies?.rows ?? [], series?.rows ?? [], watchedIndex, focus)}
          unavailable={[...(movies === null ? ["movie" as const] : []), ...(series === null ? ["series" as const] : [])]}
          action={
            <Button asChild>
              <Link href="/add">
                <Plus aria-hidden />
                Add
              </Link>
            </Button>
          }
        />
      )}
    </div>
  );
}

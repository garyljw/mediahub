"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Search, Trash2, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LibraryDeleteDialog } from "@/components/library/delete-dialog";
import { MOVIE } from "@/components/library/nouns";
import { ReleaseDialog } from "@/components/library/release-dialog";
import { grabbedMessage } from "@/components/library/release";
import { useStatusLine } from "@/components/library/use-status-line";
import { findMovieReleases, grabMovieRelease, refreshLibraryMovies, searchLibraryMovies } from "@/app/(app)/movies/actions";
import { deleteMovie } from "@/app/(app)/movies/[id]/actions";
import { MAX_BULK_MOVIES } from "./movie-bulk";
import { refreshStartedMessage } from "./movie-refresh";
import { searchStartedMessage } from "./movie-search";

const UNREACHABLE = "Couldn't reach MediaHub. Check your connection and try again.";

/**
 * The action bar on a movie's page. Search is for everyone. The rest is admin only, and the page only renders it for
 * admins. Refresh, search and the release pick reuse the shared movie actions. Delete uses the page's own action,
 * which sends the browser back to the list.
 */
export function MovieDetailActions({
  movieId,
  title,
  year,
  isAdmin,
}: {
  movieId: number;
  title: string;
  year: number | null;
  isAdmin: boolean;
}) {
  const [status, setStatus] = useStatusLine();
  const [searching, startSearch] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function search() {
    setStatus(null);
    startSearch(async () => {
      try {
        const result = await searchLibraryMovies({ movieIds: [movieId] });
        setStatus(result.ok ? searchStartedMessage(result.searched) : result.error);
      } catch {
        setStatus(UNREACHABLE);
      }
    });
  }

  function refreshAndScan() {
    setStatus(null);
    startRefresh(async () => {
      try {
        const result = await refreshLibraryMovies({ movieIds: [movieId] });
        setStatus(result.ok ? refreshStartedMessage(result.refreshed) : result.error);
      } catch {
        setStatus(UNREACHABLE);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={search} disabled={searching} aria-busy={searching}>
          <Search aria-hidden />
          Search
        </Button>
        {isAdmin && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
              <UserSearch aria-hidden />
              Pick a release…
            </Button>
            <Button size="sm" variant="secondary" onClick={refreshAndScan} disabled={refreshing} aria-busy={refreshing}>
              <RefreshCw aria-hidden />
              Refresh &amp; scan
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden />
              Delete…
            </Button>
          </>
        )}
      </div>

      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {status}
      </p>

      {isAdmin && picking && (
        <ReleaseDialog
          subject={title}
          search={() => findMovieReleases({ movieId })}
          grab={(token) => grabMovieRelease({ token })}
          onClose={() => setPicking(false)}
          onGrabbed={(grabbedTitle) => {
            setPicking(false);
            setStatus(grabbedMessage(grabbedTitle));
          }}
        />
      )}

      {isAdmin && deleting && (
        <LibraryDeleteDialog
          items={[{ id: movieId, title, year }]}
          noun={MOVIE}
          max={MAX_BULK_MOVIES}
          appName="Radarr"
          submit={({ deleteFiles, addExclusion }) => deleteMovie({ movieId, deleteFiles, addImportExclusion: addExclusion })}
          onClose={() => setDeleting(false)}
          onDeleted={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FocusToggleButton } from "@/components/focus/focus-toggle-button";
import { LibraryDeleteDialog } from "@/components/library/delete-dialog";
import { SERIES } from "@/components/library/nouns";
import { useStatusLine } from "@/components/library/use-status-line";
import { refreshLibrarySeries, searchLibrarySeries } from "@/app/(app)/tv/actions";
import { deleteSeriesItem } from "@/app/(app)/tv/[id]/actions";
import { MAX_BULK_SERIES } from "./series-bulk";
import { refreshStartedMessage } from "./series-refresh";
import { searchStartedMessage } from "./series-search";

const UNREACHABLE = "Couldn't reach MediaHub. Check your connection and try again.";

/**
 * The action bar on a series' page, for the whole series. Search and the Focus toggle are for everyone. Refresh and
 * delete are admin only, and the page only renders them for admins. Search and refresh reuse the shared series
 * actions. Delete uses the page's own action, which sends the browser back to the list.
 */
export function SeriesHeaderActions({
  seriesId,
  title,
  year,
  isAdmin,
  inFocus,
}: {
  seriesId: number;
  title: string;
  year: number | null;
  isAdmin: boolean;
  /** Whether the series is already in TV Focus, from the server, so the button starts in the right state. */
  inFocus: boolean;
}) {
  const [status, setStatus] = useStatusLine();
  const [searching, startSearch] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [deleting, setDeleting] = useState(false);

  function search() {
    setStatus(null);
    startSearch(async () => {
      try {
        const result = await searchLibrarySeries({ seriesIds: [seriesId] });
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
        const result = await refreshLibrarySeries({ seriesIds: [seriesId] });
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
        <FocusToggleButton kind="series" id={seriesId} inFocus={inFocus} onMessage={setStatus} />
        {isAdmin && (
          <>
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

      {isAdmin && deleting && (
        <LibraryDeleteDialog
          items={[{ id: seriesId, title, year }]}
          noun={SERIES}
          max={MAX_BULK_SERIES}
          appName="Sonarr"
          submit={({ deleteFiles, addExclusion }) =>
            deleteSeriesItem({ seriesId, deleteFiles, addImportListExclusion: addExclusion })
          }
          onClose={() => setDeleting(false)}
          onDeleted={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

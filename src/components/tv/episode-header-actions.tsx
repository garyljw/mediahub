"use client";

import { useState, useTransition } from "react";
import { Search, Trash2, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonitoredIcon } from "@/components/library/monitored-icon";
import { ReleaseDialog } from "@/components/library/release-dialog";
import { episodeCode, grabbedMessage } from "@/components/library/release";
import { useStatusLine } from "@/components/library/use-status-line";
import { findSeriesReleases, grabSeriesRelease, searchEpisodeNow, setEpisodeMonitoring } from "@/app/(app)/tv/[id]/actions";
import { FileDeleteDialog } from "./file-delete-dialog";
import { UNREACHABLE } from "./series-detail-actions";

/**
 * The action bar on an episode's page. Search is for everyone. Pick a release, monitor and delete file are admin only,
 * and the page only renders them for admins. A monitor change shows as the page re-rendering, so only a failure gets a message.
 */
export function EpisodeHeaderActions({
  seriesId,
  seriesTitle,
  seasonNumber,
  episodeId,
  episodeNumber,
  monitored,
  hasFile,
  isAdmin,
}: {
  seriesId: number;
  seriesTitle: string;
  seasonNumber: number;
  episodeId: number;
  episodeNumber: number;
  monitored: boolean;
  hasFile: boolean;
  isAdmin: boolean;
}) {
  const [status, setStatus] = useStatusLine();
  const [searching, startSearch] = useTransition();
  const [toggling, startToggle] = useTransition();
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const code = episodeCode(seasonNumber, episodeNumber);

  function search() {
    setStatus(null);
    startSearch(async () => {
      try {
        const result = await searchEpisodeNow({ episodeId });
        setStatus(result.ok ? "Search started" : result.error);
      } catch {
        setStatus(UNREACHABLE);
      }
    });
  }

  function toggleMonitoring() {
    setStatus(null);
    startToggle(async () => {
      try {
        const result = await setEpisodeMonitoring({ episodeId, monitored: !monitored });
        if (!result.ok) setStatus(result.error);
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
            <Button size="sm" variant="secondary" onClick={toggleMonitoring} disabled={toggling} aria-busy={toggling}>
              <MonitoredIcon monitored={monitored} />
              {monitored ? "Unmonitor" : "Monitor"}
            </Button>
            {hasFile && (
              <Button size="sm" variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden />
                Delete file…
              </Button>
            )}
          </>
        )}
      </div>

      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {status}
      </p>

      {isAdmin && picking && (
        <ReleaseDialog
          subject={`${seriesTitle} · ${code}`}
          kind="episode"
          search={() => findSeriesReleases({ episodeId })}
          grab={(token, options) => grabSeriesRelease({ token, replaceExisting: options.replaceExisting })}
          onClose={() => setPicking(false)}
          onGrabbed={(title) => {
            setPicking(false);
            setStatus(grabbedMessage(title));
          }}
        />
      )}

      {isAdmin && deleting && (
        <FileDeleteDialog
          seriesId={seriesId}
          target={{ episodeId }}
          subject={code}
          onClose={() => setDeleting(false)}
          onDeleted={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

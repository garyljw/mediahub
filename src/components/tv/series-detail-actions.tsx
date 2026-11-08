"use client";

import { useEffect, useState, useTransition, type MouseEvent } from "react";
import { ListChecks, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonitoredIcon } from "@/components/library/monitored-icon";
import { ReleaseDialog } from "@/components/library/release-dialog";
import { episodeCode, grabbedMessage, type ReleaseSearchResult } from "@/components/library/release";
import type { ActionResult } from "@/app/(app)/tv/[id]/actions";
import {
  findSeriesReleases,
  grabSeriesRelease,
  searchEpisodeNow,
  searchSeasonNow,
  setEpisodeMonitoring,
  setSeasonMonitoring,
} from "@/app/(app)/tv/[id]/actions";

// How long a result note stays beside its control.
const NOTE_MS = 4000;
const UNREACHABLE = "Couldn't reach MediaHub. Check your connection and try again.";

/** A short result shown beside one control. `ok` picks the live-region role: a status when it worked, an alert when not. */
type Note = { ok: boolean; text: string };

/** Holds one control's note and clears it after a few seconds, like the other status lines. */
function useNote() {
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    if (note === null) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);
  return [note, setNote] as const;
}

/** The note for an action result. A success gets the given text; a failure gets the server's message. */
function noteFor(result: ActionResult, successText: string): Note {
  return result.ok ? { ok: true, text: successText } : { ok: false, text: result.error };
}

function NoteText({ note }: { note: Note | null }) {
  if (note === null) return null;
  return (
    <span role={note.ok ? "status" : "alert"} className={note.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
      {note.text}
    </span>
  );
}

/**
 * Stops a click on a season control from reaching <summary>. Without this, pressing the control would also
 * open or close the season.
 */
function keepSeasonOpen(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * One monitor toggle: the bookmark icon as a button. A success shows as the icon changing once the page
 * re-renders, so only a failure gets a note. `inSummary` stops the click from opening or closing the season.
 */
function MonitorToggle({
  name,
  monitored,
  inSummary,
  run,
}: {
  /** What the toggle acts on, e.g. "Season 2" or "Season 2 episode 3", used in the accessible name. */
  name: string;
  monitored: boolean;
  inSummary: boolean;
  run: (monitored: boolean) => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useNote();

  function toggle(event: MouseEvent) {
    if (inSummary) keepSeasonOpen(event);
    startTransition(async () => {
      try {
        const result = await run(!monitored);
        setNote(result.ok ? null : { ok: false, text: result.error });
      } catch {
        setNote({ ok: false, text: UNREACHABLE });
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`${monitored ? "Unmonitor" : "Monitor"} ${name}`}
        aria-busy={pending}
        disabled={pending}
        onClick={toggle}
      >
        <MonitoredIcon monitored={monitored} />
      </Button>
      <NoteText note={note} />
    </span>
  );
}

/** One search button. Shows "Search started" or the error beside it. */
function SearchButton({
  name,
  hint,
  inSummary,
  run,
}: {
  name: string;
  hint?: string;
  inSummary: boolean;
  run: () => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useNote();

  function search(event: MouseEvent) {
    if (inSummary) keepSeasonOpen(event);
    startTransition(async () => {
      try {
        setNote(noteFor(await run(), "Search started"));
      } catch {
        setNote({ ok: false, text: UNREACHABLE });
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Search ${name}`}
        title={hint}
        aria-busy={pending}
        disabled={pending}
        onClick={search}
      >
        <Search aria-hidden />
      </Button>
      <NoteText note={note} />
    </span>
  );
}

/** Admin toggle for one season's monitored flag. Sonarr then sets that season's episodes to match. */
export function SeasonMonitorToggle({
  seriesId,
  seasonNumber,
  label,
  monitored,
}: {
  seriesId: number;
  seasonNumber: number;
  /** "Season 2" or "Specials", used in the accessible name. */
  label: string;
  monitored: boolean;
}) {
  return (
    <MonitorToggle
      name={label}
      monitored={monitored}
      inSummary
      run={(next) => setSeasonMonitoring({ seriesId, seasonNumber, monitored: next })}
    />
  );
}

/** Admin toggle for one episode's own monitored flag. */
export function EpisodeMonitorToggle({
  episodeId,
  episodeNumber,
  seasonLabel,
  monitored,
}: {
  episodeId: number;
  episodeNumber: number;
  /** "Season 2" or "Specials", so the accessible name is unique across open seasons. */
  seasonLabel: string;
  monitored: boolean;
}) {
  return (
    <MonitorToggle
      name={`${seasonLabel} episode ${episodeNumber}`}
      monitored={monitored}
      inSummary={false}
      run={(next) => setEpisodeMonitoring({ episodeId, monitored: next })}
    />
  );
}

/** Search for one season's monitored episodes. Admins and requesters both get it. */
export function SeasonSearchButton({
  seriesId,
  seasonNumber,
  label,
}: {
  seriesId: number;
  seasonNumber: number;
  /** "Season 2" or "Specials", used in the accessible name. */
  label: string;
}) {
  return (
    <SearchButton
      name={label}
      hint="Searches this season's monitored episodes"
      inSummary
      run={() => searchSeasonNow({ seriesId, seasonNumber })}
    />
  );
}

/** Search for one episode. Admins and requesters both get it. */
export function EpisodeSearchButton({
  episodeId,
  episodeNumber,
  seasonLabel,
}: {
  episodeId: number;
  episodeNumber: number;
  /** "Season 2" or "Specials", so the accessible name is unique across open seasons. */
  seasonLabel: string;
}) {
  return (
    <SearchButton
      name={`${seasonLabel} episode ${episodeNumber}`}
      inSummary={false}
      run={() => searchEpisodeNow({ episodeId })}
    />
  );
}

/**
 * Admin "Pick a release" for one season or one episode. Opens the shared release dialog for that search. A grab
 * shows its result beside the button, like a search does. `inSummary` stops the click from opening or closing the season.
 */
function ReleasePickButton({
  name,
  subject,
  kind,
  inSummary,
  search,
}: {
  /** What the button acts on, e.g. "Season 2" or "Season 2 episode 3", used in the accessible name. */
  name: string;
  /** The dialog heading's subject, e.g. "Breaking Bad · Season 2". */
  subject: string;
  kind: "season" | "episode";
  inSummary: boolean;
  search: () => Promise<ReleaseSearchResult>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useNote();

  function openPicker(event: MouseEvent) {
    if (inSummary) keepSeasonOpen(event);
    setOpen(true);
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Pick a release for ${name}`}
        onClick={openPicker}
      >
        <ListChecks aria-hidden />
      </Button>
      <NoteText note={note} />
      {open && (
        <ReleaseDialog
          subject={subject}
          kind={kind}
          search={search}
          grab={(token) => grabSeriesRelease({ token })}
          onClose={() => setOpen(false)}
          onGrabbed={(title) => {
            setOpen(false);
            setNote({ ok: true, text: grabbedMessage(title) });
          }}
        />
      )}
    </span>
  );
}

/** Admin pick for one season's release, from Sonarr's season search. Only admins get it: the page doesn't render it otherwise. */
export function SeasonReleaseButton({
  seriesId,
  seriesTitle,
  seasonNumber,
  label,
}: {
  seriesId: number;
  seriesTitle: string;
  seasonNumber: number;
  /** "Season 2" or "Specials", used in the accessible name and the dialog heading. */
  label: string;
}) {
  return (
    <ReleasePickButton
      name={label}
      subject={`${seriesTitle} · ${label}`}
      kind="season"
      inSummary
      search={() => findSeriesReleases({ seriesId, seasonNumber })}
    />
  );
}

/** Admin pick for one episode's release, from Sonarr's episode search. Only admins get it: the page doesn't render it otherwise. */
export function EpisodeReleaseButton({
  seriesTitle,
  seasonNumber,
  episodeId,
  episodeNumber,
  seasonLabel,
}: {
  seriesTitle: string;
  seasonNumber: number;
  episodeId: number;
  episodeNumber: number;
  /** "Season 2" or "Specials", so the accessible name is unique across open seasons. */
  seasonLabel: string;
}) {
  return (
    <ReleasePickButton
      name={`${seasonLabel} episode ${episodeNumber}`}
      subject={`${seriesTitle} · ${episodeCode(seasonNumber, episodeNumber)}`}
      kind="episode"
      inSummary={false}
      search={() => findSeriesReleases({ episodeId })}
    />
  );
}

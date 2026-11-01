"use client";

import { useEffect, useState, useTransition, type MouseEvent } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonitoredIcon } from "@/components/tv/series-monitored";
import type { ActionResult } from "@/app/(app)/tv/[id]/actions";
import {
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

/** Holds one control's note and clears it after a few seconds, like the table's status line. */
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

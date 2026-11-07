"use client";

import { useRef, useState } from "react";
import { BookmarkCheck, BookmarkPlus } from "lucide-react";
import { addFocusItem, removeFocusItems, type FocusResult } from "@/app/(app)/focus/actions";
import { FOCUS_NAME, type FocusKind } from "@/components/focus/focus-kinds";
import { Button } from "@/components/ui/button";

const UNREACHABLE = "Couldn't reach MediaHub. Check your connection and try again.";

/**
 * The Add to / Remove from Focus button on a movie's or series' page. It flips straight away, and reverts with a
 * message when the save fails. Same behaviour as the Home grid's right-click menu, which uses the same actions.
 */
export function FocusToggleButton({
  kind,
  id,
  inFocus,
  onMessage,
}: {
  kind: FocusKind;
  id: number;
  inFocus: boolean;
  onMessage: (message: string | null) => void;
}) {
  const [inList, setInList] = useState(inFocus);
  const [pending, setPending] = useState(false);
  // Follow new page data when it arrives (a refresh, or another title's page reusing this button), unless a save is
  // still pending: that save's own result settles the state.
  const [source, setSource] = useState(inFocus);
  if (source !== inFocus) {
    setSource(inFocus);
    if (!pending) setInList(inFocus);
  }
  // A ref as well as the state, so a second click before the first save returns is ignored.
  const pendingRef = useRef(false);
  const name = FOCUS_NAME[kind];

  async function toggle() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    onMessage(null);
    const add = !inList;
    setInList(add);

    let result: FocusResult;
    try {
      result = add ? await addFocusItem({ kind, id }) : await removeFocusItems({ kind, ids: [id] });
    } catch {
      result = { ok: false, error: UNREACHABLE };
    }

    pendingRef.current = false;
    setPending(false);
    if (!result.ok) {
      setInList(!add);
      onMessage(result.error);
    }
  }

  return (
    <Button size="sm" variant="secondary" onClick={() => void toggle()} disabled={pending} aria-busy={pending}>
      {inList ? <BookmarkCheck aria-hidden /> : <BookmarkPlus aria-hidden />}
      {inList ? `Remove from ${name}` : `Add to ${name}`}
    </Button>
  );
}

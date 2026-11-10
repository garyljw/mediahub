"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { jumpLetter, LETTERS, letterOrder } from "./letter";
import { findTile, settleOn } from "./return-place";

/** Below this height per letter the bar shows every other letter, with a dot between. */
const ROW_PX = 14;
/** Space left above a jump target, so its poster isn't flush with the top of the window. */
const MARGIN_PX = 16;

/** Short buzz on Android when the letter changes. iOS ignores vibrate, so this is harmless there. */
function buzz() {
  try {
    navigator.vibrate?.(5);
  } catch {
    // Not supported: nothing to do.
  }
}

/**
 * The A–Z jump bar for Home, when it is sorted by title. `index` maps each letter to the first shown tile with that letter.
 * Tap a letter to jump to it. On touch, press and drag along the bar: the letter under the finger is worked out from its
 * height, over every letter (not from what is under the finger), and the page jumps as the letter changes. Letters with no
 * titles are dimmed and jump to the next letter that has some, in the bar's order.
 */
export function LetterBar({ dir, index }: { dir: "asc" | "desc"; index: ReadonlyMap<string, string> }) {
  const order = letterOrder(dir);
  const available = new Set(index.keys());
  const navRef = useRef<HTMLElement>(null);
  // The drag in progress, and the letter it last landed on, so a move within one letter does nothing.
  const drag = useRef<{ last: string | null } | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  // Too short for every letter: show every other one, with a dot between. Every letter still resolves by position.
  const [short, setShort] = useState(false);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    // ResizeObserver calls back once when it starts observing, so the first size is read without a setState here.
    const observer = new ResizeObserver(() => {
      setShort(nav.getBoundingClientRect().height < LETTERS.length * ROW_PX);
    });
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  function jumpTo(letter: string) {
    const target = jumpLetter(letter, order, available);
    const key = target === null ? undefined : index.get(target);
    const tile = key === undefined ? null : findTile(key);
    if (!tile) return;
    window.scrollTo({ top: Math.max(0, tile.getBoundingClientRect().top + window.scrollY - MARGIN_PX), behavior: "instant" });
    settleOn(tile, MARGIN_PX);
  }

  /** The letter whose slot the pointer is over, found by its height among all the letters. */
  function letterAt(clientY: number): string {
    const nav = navRef.current;
    const rect = nav?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return order[0] ?? "#";
    const position = Math.floor(((clientY - rect.top) / rect.height) * order.length);
    return order[Math.min(order.length - 1, Math.max(0, position))] ?? "#";
  }

  function moveTo(clientY: number) {
    const current = drag.current;
    if (!current) return;
    const letter = letterAt(clientY);
    if (letter === current.last) return;
    current.last = letter;
    setBubble(letter);
    jumpTo(letter);
    buzz();
  }

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Capture, so the move and up events keep coming to the bar even when the finger leaves it.
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { last: null };
    moveTo(event.clientY);
  }

  function endDrag() {
    drag.current = null;
    setBubble(null);
  }

  return (
    <>
      <nav
        ref={navRef}
        aria-label="Jump to letter"
        onPointerDown={startDrag}
        onPointerMove={(event) => {
          if (drag.current) moveTo(event.clientY);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="fixed top-4 right-0.5 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex w-6 touch-none flex-col items-center select-none lg:bottom-4"
      >
        {order.map((letter, position) => {
          const has = available.has(letter);
          const hidden = short && position % 2 === 1;
          return (
            <button
              key={letter}
              type="button"
              aria-label={letter === "#" ? "Jump to numbers and symbols" : `Jump to ${letter}`}
              onClick={() => jumpTo(letter)}
              className={cn(
                "flex min-h-0 w-full flex-1 items-center justify-center rounded-sm text-[10px] leading-none font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                !has && "opacity-40",
              )}
            >
              <span aria-hidden>{hidden ? "•" : letter}</span>
            </button>
          );
        })}
      </nav>
      {bubble !== null && (
        <div
          aria-hidden
          className="pointer-events-none fixed top-1/2 left-1/2 z-30 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-card/90 text-4xl font-bold shadow-lg"
        >
          {bubble}
        </div>
      )}
    </>
  );
}

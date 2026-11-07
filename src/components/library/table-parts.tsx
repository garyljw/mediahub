"use client";

import { useCallback, useRef, type MouseEvent, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const CELL = "py-1.5 px-2";
export const HEAD = "sticky top-0 z-10 h-8 border-b bg-background py-1.5 px-2";
export const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * The ⋯ menu for one admin row. Pick and Delete open dialogs, so their onSelect only remembers the
 * action (through `defer`). The action runs from onCloseAutoFocus. Radix calls that handler and then focuses
 * the ⋯ trigger in the same timeout callback. The state change from this handler renders after that focus, so
 * the dialog's FocusScope saves the trigger as the element to return focus to. The menu is non-modal because
 * a modal menu locks the page with body pointer-events, and that lock fights a dialog opened while it closes.
 */
export function RowMenu({
  title,
  onOpen,
  onClosed,
  children,
}: {
  title: string;
  onOpen: () => void;
  /** Called once the menu has closed, whatever the reason. */
  onClosed: () => void;
  /** The menu items. `defer` takes the action of a dialog-opening item; plain items use their own onSelect. */
  children: (defer: (run: () => void) => void) => ReactNode;
}) {
  const pending = useRef<(() => void) | null>(null);
  // Dialog-opening items call this from onSelect. The action waits in the ref until the menu has closed.
  const defer = useCallback((run: () => void) => {
    pending.current = run;
  }, []);
  return (
    <DropdownMenu modal={false} onOpenChange={(open) => open && onOpen()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${title}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={() => {
          const run = pending.current;
          pending.current = null;
          onClosed();
          run?.();
        }}
      >
        {/* eslint-disable-next-line react-hooks/refs -- the render prop only builds the items. defer is called from onSelect, never during render. */}
        {children(defer)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Click handler for an expandable card or table row: a click anywhere on it toggles it, so the chevron (which a hover
 * card can cover) isn't the only target. Clicks on its own controls, inside its open details, or that end a text
 * selection are left alone. The chevron stays as the keyboard and screen reader control.
 */
export function toggleOnClick(onToggle: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    const target = event.target;
    // An open ⋯ menu is portalled outside the card, but its clicks still bubble here through React. Ignore them.
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
    if (target.closest("a, button, input, select, textarea, [role=menuitem], [data-card-details]")) return;
    // A click that ends a text selection inside this row or card (e.g. copying a title) isn't a toggle. A selection
    // elsewhere on the page doesn't count.
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed && selection.containsNode(event.currentTarget, true)) return;
    onToggle();
  };
}

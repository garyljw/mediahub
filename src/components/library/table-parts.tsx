"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortDir } from "./list";

export const CELL = "py-1.5 px-2";
export const HEAD = "sticky top-0 z-10 h-8 border-b bg-background py-1.5 px-2";
export const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

/** A column header that sorts the table when clicked. Clicking the active column flips its direction. */
export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  width,
}: {
  label: string;
  sortKey: K;
  sort: { key: K; dir: SortDir };
  onSort: (key: K) => void;
  align?: "left" | "right";
  /** A fixed column width class. Only the Title column has none, so it takes the remaining space. */
  width?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      className={cn(HEAD, width, align === "right" && "text-right")}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      >
        {label}
        <Icon aria-hidden className={cn("size-3.5", !active && "text-muted-foreground/60")} />
      </button>
    </TableHead>
  );
}

/** The page controls under a table. Renders nothing when there is only one page. */
export function Pagination({ current, pages, onPage }: { current: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-2 text-sm">
      <Button variant="outline" size="sm" disabled={current <= 1} onClick={() => onPage(current - 1)}>
        Prev
      </Button>
      <span>
        Page {current} of {pages}
      </span>
      <Button variant="outline" size="sm" disabled={current >= pages} onClick={() => onPage(current + 1)}>
        Next
      </Button>
    </nav>
  );
}

/**
 * The ⋯ menu for one admin row. Pick, Edit and Delete open dialogs, so their onSelect only remembers the
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

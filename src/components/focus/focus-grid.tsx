"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type SyntheticEvent } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, EllipsisVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { removeFocusItems, reorderFocusItems, type FocusResult } from "@/app/(app)/focus/actions";
import { PosterTile } from "@/components/poster/poster";
import { HomeTile } from "@/components/home/home-grid";
import { useTilePeek } from "@/components/home/tile-peek";
import { withWatched, type HomeItem, type HomeWatched } from "@/components/home/home-items";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { mergeVisibleOrder, moveInOrder } from "./focus-order";
import { FOCUS_APP, FOCUS_NAME, SAVE_FAILED, type FocusKind } from "./focus-kinds";
import { POSTER_GRID_CLASS, POSTER_TILE_CLASS } from "@/components/poster/poster-grid";

// Space picks up a tile, the arrows move it, Space or Enter drops it. Enter isn't a start key, so it still opens the link.
const KEYBOARD_CODES = { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] };

type Order = { items: HomeItem[]; allIds: number[]; missing: number[] };

/**
 * One Focus list as a grid of posters. Drag to reorder (mouse, touch press-and-hold, keyboard), or use the tile's menu
 * (Move to front, earlier, later, end, Remove). The new order shows at once. Only one save runs at a time: while it's
 * pending, drags and menu moves are ignored. A failed save goes back to the order from before that save.
 * `items` are the stored titles that are in the library, in Focus order. `allIds` is the whole stored list, which the
 * server checks. `missing` are stored titles no longer in the library; the notice above the grid removes them.
 * `watched` is the Plex status, which arrives after the tiles: until then they show without banners.
 */
export function FocusGrid({
  kind,
  items,
  allIds,
  missing,
  watched,
}: {
  kind: FocusKind;
  items: HomeItem[];
  allIds: number[];
  missing: number[];
  watched: Promise<HomeWatched>;
}) {
  const router = useRouter();
  const [watchedState, setWatchedState] = useState<HomeWatched | null>(null);
  useEffect(() => {
    let cancelled = false;
    watched.then((value) => {
      if (!cancelled) setWatchedState(value);
    });
    return () => {
      cancelled = true;
    };
  }, [watched]);
  // The server's data is the source of truth. When the page is refreshed with new props, the local order follows
  // them, but never while a save is pending.
  const [source, setSource] = useState({ items, allIds, missing });
  const [order, setOrder] = useState<Order>({ items, allIds, missing });
  const [pending, setPending] = useState(false);
  // `latest` mirrors the shown order, so a save knows what to roll back to. commit() sets it at once; a prop sync sets
  // it in a layout effect, which runs in the same commit, before any input event can reach a handler.
  const latest = useRef(order);
  useLayoutEffect(() => {
    latest.current = order;
  }, [order]);
  if (!pending && (source.items !== items || source.allIds !== allIds || source.missing !== missing)) {
    setSource({ items, allIds, missing });
    setOrder({ items, allIds, missing });
  }

  // The tiles shown: the order with the watched states applied. The order itself (and every save) works on the items
  // without them, so the reorder logic is the same either way.
  const watchedByKey = watchedState?.state === "ready" ? watchedState.byKey : null;
  const shownItems = useMemo(() => withWatched(order.items, watchedByKey), [order.items, watchedByKey]);
  const shownByKey = useMemo(() => new Map(shownItems.map((item) => [item.key, item])), [shownItems]);
  const { gridHandlers, card } = useTilePeek((key) => shownByKey.get(key));

  // `busy` blocks a second save synchronously, before React re-renders.
  const busy = useRef(false);
  const [drag, setDrag] = useState<{ id: number; width: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    // MouseSensor, not PointerSensor: PointerSensor also starts on touch at once, which would skip the touch delay.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: KEYBOARD_CODES }),
  );

  function commit(next: Order) {
    latest.current = next;
    setOrder(next);
  }

  /** Shows `next` now and runs `request`. A refusal, or a thrown error, goes back to the order from before this save. */
  function save(next: Order, request: () => Promise<FocusResult>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const before = latest.current;
    commit(next);
    setError(null);
    void (async () => {
      let result: FocusResult;
      try {
        result = await request();
      } catch {
        result = { ok: false, error: SAVE_FAILED };
      }
      busy.current = false;
      setPending(false);
      if (result.ok) return;
      commit(before);
      setError(result.error);
      // A stale order means another tab changed the list. The reload brings the server's order back as new props.
      if (result.stale) router.refresh();
    })();
  }

  function moveTo(id: number, toIndex: number) {
    if (busy.current) return;
    const current = latest.current;
    const before = current.items.map((item) => item.id);
    const after = moveInOrder(before, id, toIndex);
    if (after.every((value, index) => value === before[index])) return;
    const byId = new Map(current.items.map((item) => [item.id, item]));
    const nextItems = after.flatMap((value) => {
      const item = byId.get(value);
      return item ? [item] : [];
    });
    const nextAll = mergeVisibleOrder(current.allIds, before, after);
    save({ items: nextItems, allIds: nextAll, missing: current.missing }, () => reorderFocusItems({ kind, ids: nextAll }));
  }

  /** Removes titles from the list. Used by a tile's Remove and by the notice's "Remove them". */
  function removeIds(ids: number[]) {
    if (busy.current || ids.length === 0) return;
    const current = latest.current;
    const gone = new Set(ids);
    save(
      {
        items: current.items.filter((item) => !gone.has(item.id)),
        allIds: current.allIds.filter((value) => !gone.has(value)),
        missing: current.missing.filter((value) => !gone.has(value)),
      },
      () => removeFocusItems({ kind, ids }),
    );
  }

  function handleDragStart(event: DragStartEvent) {
    setDrag({ id: Number(event.active.id), width: event.active.rect.current.initial?.width ?? null });
  }

  function handleDragEnd(event: DragEndEvent) {
    setDrag(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const to = latest.current.items.findIndex((item) => item.id === Number(over.id));
    if (to === -1) return;
    moveTo(Number(active.id), to);
  }

  const dragged = drag === null ? undefined : order.items.find((item) => item.id === drag.id);
  const count = order.items.length;
  const missingCount = order.missing.length;

  return (
    <div className="space-y-3">
      {missingCount > 0 && (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            {missingCount === 1
              ? `1 title in ${FOCUS_NAME[kind]} is no longer in ${FOCUS_APP[kind]}.`
              : `${missingCount} titles in ${FOCUS_NAME[kind]} are no longer in ${FOCUS_APP[kind]}.`}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => removeIds(order.missing)}
            className="self-start rounded-md border px-3 py-1 font-medium hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 sm:self-auto"
          >
            {missingCount === 1 ? "Remove it" : "Remove them"}
          </button>
        </div>
      )}
      {watchedState?.state === "failed" && (
        <p role="status" className="inline-flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
          Couldn&apos;t load watched status from Plex.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDrag(null)}
      >
        <SortableContext items={order.items.map((item) => item.id)} strategy={rectSortingStrategy}>
          <ul {...gridHandlers} className={POSTER_GRID_CLASS}>
            {shownItems.map((item, index) => (
              <FocusTile
                key={item.key}
                item={item}
                index={index}
                count={count}
                busy={pending}
                onMove={moveTo}
                onRemove={(id) => removeIds([id])}
              />
            ))}
          </ul>
        </SortableContext>
        <DragOverlay>
          {dragged ? (
            // The overlay is the dragged tile's measured width, so it matches the grid at any breakpoint.
            <div className="rounded-md shadow-xl" style={drag?.width ? { width: drag.width } : undefined}>
              <PosterTile src={dragged.posterSrc} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {card}
    </div>
  );
}

type MenuAction = { key: string; label: string; disabled?: boolean; destructive?: boolean; run: () => void };

/** Stops a tile's drag listeners from seeing events that come from the tile's own controls or its menus. */
function isolate(event: SyntheticEvent) {
  event.stopPropagation();
}
const ISOLATE = { onPointerDown: isolate, onMouseDown: isolate, onTouchStart: isolate, onKeyDown: isolate, onContextMenu: isolate };

/**
 * One draggable tile. The whole tile is the drag handle, and the link still opens the title on a click or tap, because
 * the sensors only start a drag after movement or a delay. Right-click and the ⋯ button open the same menu.
 */
function FocusTile({
  item,
  index,
  count,
  busy,
  onMove,
  onRemove,
}: {
  item: HomeItem;
  index: number;
  count: number;
  busy: boolean;
  onMove: (id: number, toIndex: number) => void;
  onRemove: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: busy,
  });
  // The last kind of input, so a touch long press (which Chrome reports as contextmenu) doesn't open the menu or
  // Chrome's own menu while a drag is pending. A mouse right-click and the keyboard Menu key still open it.
  const lastInput = useRef<"mouse" | "touch" | "keyboard">("mouse");

  const actions: MenuAction[] = [
    { key: "front", label: "Move to front", disabled: busy || index === 0, run: () => onMove(item.id, 0) },
    { key: "earlier", label: "Move earlier", disabled: busy || index === 0, run: () => onMove(item.id, index - 1) },
    { key: "later", label: "Move later", disabled: busy || index === count - 1, run: () => onMove(item.id, index + 1) },
    { key: "end", label: "Move to end", disabled: busy || index === count - 1, run: () => onMove(item.id, count - 1) },
    { key: "remove", label: "Remove from Focus", disabled: busy, destructive: true, run: () => onRemove(item.id) },
  ];

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    touchAction: "manipulation",
    WebkitTouchCallout: "none",
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onPointerDown={(event: PointerEvent) => {
          lastInput.current = event.pointerType === "mouse" ? "mouse" : "touch";
          // Stops Radix opening its own long-press menu for touch and pen. The drag and the native menu handle those.
          if (event.pointerType !== "mouse") event.preventDefault();
        }}
        onKeyDownCapture={() => {
          lastInput.current = "keyboard";
        }}
        onContextMenu={(event) => {
          if (lastInput.current === "touch") event.preventDefault();
        }}
      >
        <li
          ref={setNodeRef}
          style={style}
          aria-describedby={attributes["aria-describedby"]}
          className={cn(
            "relative",
            POSTER_TILE_CLASS,
            isDragging && "opacity-40",
          )}
          {...listeners}
        >
          <HomeTile item={item} activity={undefined} showFocusMarker={false} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More options for ${item.title}`}
                className="absolute top-1.5 left-1.5 rounded bg-black/65 p-1 text-white focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                {...ISOLATE}
              >
                <EllipsisVertical aria-hidden className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" {...ISOLATE}>
              {actions.map((action) => (
                <DropdownMenuItem
                  key={action.key}
                  disabled={action.disabled}
                  variant={action.destructive ? "destructive" : "default"}
                  onSelect={action.run}
                >
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((action) => (
          <ContextMenuItem
            key={action.key}
            disabled={action.disabled}
            variant={action.destructive ? "destructive" : "default"}
            onSelect={action.run}
          >
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import {
  savePopularServices,
  type PopularServicesResult,
} from "@/app/(app)/settings/popular/actions";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/** A streaming service as the browser sees it: only the id and the name. */
export type ServiceOption = { id: number; name: string };

function ChosenRow({
  service,
  onRemove,
}: {
  service: ServiceOption;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: service.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 ${isDragging ? "relative z-10 shadow-md" : ""}`}
    >
      <button
        type="button"
        aria-label={`Drag ${service.name}`}
        className="cursor-grab touch-none text-muted-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="flex-1 text-sm">{service.name}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove ${service.name}`}
        onClick={onRemove}
      >
        <X />
      </Button>
    </li>
  );
}

/**
 * The services the Popular page offers: a draggable list, plus a searchable picker for the rest. Nothing is stored
 * until Save, and the server action checks the ids against TMDB before it stores them.
 */
export function PopularServicesForm({
  services,
  initialIds,
}: {
  /** Every service TMDB offers (movies or TV) in the country, in rank order. */
  services: ServiceOption[];
  initialIds: number[];
}) {
  const [ids, setIds] = useState<number[]>(initialIds);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<PopularServicesResult | null>(null);
  const [pending, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const byId = new Map(services.map((s) => [s.id, s]));
  const chosen = ids.flatMap((id) => byId.get(id) ?? []);
  const available = services.filter((s) => !ids.includes(s.id));

  function change(next: number[]) {
    setIds(next);
    setResult(null);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from >= 0 && to >= 0) change(arrayMove(ids, from, to));
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        setResult(await savePopularServices({ ids }));
      } catch {
        setResult({
          ok: false,
          message: "Couldn't save the Popular services.",
        });
      }
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {/* The picker sits in the page, not in a popup: a popup under the list moved down with every pick and then
          flipped over the list. Side by side on wide screens, stacked on a phone. */}
      <div className="grid items-start gap-6 md:grid-cols-2">
        <section aria-labelledby="popular-chosen-heading" className="space-y-2">
          <h2 id="popular-chosen-heading" className="text-sm font-medium">
            Shown on Popular
          </h2>
          {chosen.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None picked: the Popular page shows TMDB&apos;s top 12.
            </p>
          ) : (
            // A fixed id keeps dnd-kit's accessibility ids the same on the server and in the browser.
            <DndContext
              id="popular-services"
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={ids}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-2">
                  {chosen.map((service) => (
                    <ChosenRow
                      key={service.id}
                      service={service}
                      onRemove={() =>
                        change(ids.filter((id) => id !== service.id))
                      }
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </section>
        <section aria-labelledby="popular-add-heading" className="space-y-2">
          <h2 id="popular-add-heading" className="text-sm font-medium">
            Add services
          </h2>
          <Command className="rounded-md border">
            <CommandInput
              placeholder="Search services…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="h-72 max-h-none">
              <CommandEmpty>No service matches.</CommandEmpty>
              {available.map((service) => (
                <CommandItem
                  key={service.id}
                  value={`${service.name} ${service.id}`}
                  onSelect={() => {
                    change([...ids, service.id]);
                    setSearch("");
                  }}
                >
                  {service.name}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </section>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => change([])}
        >
          Reset to top 12
        </Button>
      </div>
      {result?.ok === true && (
        <p role="status" className="text-sm">
          Saved.
        </p>
      )}
      {result?.ok === false && (
        <p role="alert" className="text-sm text-destructive">
          {result.message}
        </p>
      )}
    </form>
  );
}

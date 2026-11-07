// Loading placeholders for each page. Each one keeps its page's outer layout and heading, so nothing moves when the data
// arrives. Shapes only: no data is read here, so these can be shared between users. Server-safe, no "use client".
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { FOCUS_NAME, type FocusKind } from "@/components/focus/focus-kinds";

/** Tells screen readers the page is loading, since the skeleton blocks themselves are hidden from them. */
function LoadingStatus() {
  return (
    <p role="status" className="sr-only">
      Loading…
    </p>
  );
}

/** The grid of poster tiles, with the same column classes as the Home grid. */
export function PosterGridSkeleton({ count }: { count: number }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-3 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]">
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>
          <Skeleton className="aspect-[2/3] w-full" />
          <Skeleton className="mt-2 h-3 w-4/5" />
          <Skeleton className="mt-1.5 h-3 w-2/5" />
        </li>
      ))}
    </ul>
  );
}

/** The Home grid's body while the library loads: the count line and 24 poster tiles. */
export function HomeGridSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-24" />
      <PosterGridSkeleton count={24} />
    </div>
  );
}

/** Home: the heading, a toolbar, and the grid's placeholder. */
export function HomeSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <LoadingStatus />
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-9 w-64 sm:max-w-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
      <HomeGridSkeleton />
    </div>
  );
}

/** A movie or series page: the Home link, the hero, and the Details card. */
export function ItemPageSkeleton() {
  return (
    <div aria-busy="true" className="space-y-6">
      <LoadingStatus />
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Home
      </Link>

      <section className="relative overflow-hidden rounded-xl border bg-card/60 backdrop-blur-sm">
        <div className="relative flex flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
          <div className="w-32 shrink-0 -rotate-[1.5deg] self-start rounded-md shadow-lg sm:w-40 md:w-48">
            <Skeleton className="aspect-[2/3] w-full" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-8 w-3/5" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">Details</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="space-y-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/** A table page (Queue, History): the heading, then a table card at lg and up or a stack of cards below that. */
export function TablePageSkeleton({ title, rows = 8, columns }: { title: string; rows?: number; columns: number }) {
  // The first cell holds a poster thumbnail and a title line. The rest hold one text line each.
  const cells = Array.from({ length: columns }, (_, index) => index);
  return (
    <div aria-busy="true" className="space-y-4">
      <LoadingStatus />
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="hidden overflow-hidden rounded-xl border bg-card lg:block">
        <div className="flex h-8 items-center gap-4 border-b px-2">
          {cells.map((cell) => (
            <Skeleton key={cell} className="h-3 flex-1 rounded-sm" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4 border-b px-2 py-1.5 last:border-b-0">
            {cells.map((cell) =>
              cell === 0 ? (
                <div key={cell} className="flex flex-[2] items-center gap-3">
                  <Skeleton className="h-9 w-6 shrink-0 rounded-sm" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              ) : (
                <div key={cell} className="flex-1">
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      <ul className="space-y-2 lg:hidden">
        {Array.from({ length: rows }, (_, row) => (
          <li key={row} className="flex gap-3 rounded-xl border bg-card p-3">
            <Skeleton className="h-9 w-6 shrink-0 rounded-sm" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Calendar page: the heading, the range buttons, the range line, and a list of rows. */
export function CalendarSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <LoadingStatus />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <Skeleton className="h-5 w-48" />
      <div className="space-y-3 rounded-xl border bg-card p-4">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

/** The Add page: the Home link, the heading, the search box, and a few result rows. */
export function AddSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <LoadingStatus />
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Home
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add</h1>
      <Skeleton className="h-9 w-full sm:max-w-sm" />
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}

/** A Focus list page: its name as the heading, the add search, and a poster grid. */
export function FocusSkeleton({ kind }: { kind: FocusKind }) {
  return (
    <div aria-busy="true" className="space-y-4">
      <LoadingStatus />
      <h1 className="text-2xl font-semibold tracking-tight">{FOCUS_NAME[kind]}</h1>
      <Skeleton className="h-9 w-full sm:max-w-sm" />
      <PosterGridSkeleton count={6} />
    </div>
  );
}

/**
 * A settings page. Sub-pages have different headings, so no heading text here: just a block where the heading goes,
 * then two cards.
 */
export function SettingsSkeleton() {
  return (
    <div aria-busy="true">
      <LoadingStatus />
      <Skeleton className="h-8 w-48" />
      <div className="mt-6 space-y-6">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="space-y-4 rounded-lg border p-5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

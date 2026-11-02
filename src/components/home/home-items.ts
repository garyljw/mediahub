// Pure helpers for the Home grid: the merged item shape, filtering and ordering. Client-safe: no runtime imports from src/server.
import { addedTime, compareValues, matchesTitleOrYear, TITLE_COLLATOR } from "@/components/library/list";

/** One tile on the Home grid. `key` is needed because movie and series ids can collide. */
export type HomeItem = {
  key: string;
  kind: "movie" | "series";
  id: number;
  title: string;
  year: number | null;
  sortTitle: string;
  added: string | null;
  href: string;
  posterSrc: string | null;
  badge: { label: string; className: string };
};

export type HomeKind = "all" | "movie" | "series";

/** How many tiles show at first, and how many each "Show more" adds. */
export const HOME_PAGE_SIZE = 60;

export type HomeFilter = { kind: HomeKind; search: string };

/** Keeps the items of one kind (or all kinds) that match the search. An empty search matches everything. */
export function filterHomeItems(items: HomeItem[], filter: HomeFilter): HomeItem[] {
  return items.filter(
    (item) => (filter.kind === "all" || item.kind === filter.kind) && matchesTitleOrYear(item, filter.search),
  );
}

// Movies sort before series when everything else ties.
const KIND_RANK: Record<HomeItem["kind"], number> = { movie: 0, series: 1 };

/**
 * Newest added first. Items without a date go last. Ties go by title, then movie before series, then id.
 * Use with Array.prototype.sort.
 */
export function compareHomeItems(a: HomeItem, b: HomeItem): number {
  return (
    compareValues(addedTime(a.added), addedTime(b.added), "desc") ||
    TITLE_COLLATOR.compare(a.sortTitle, b.sortTitle) ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    a.id - b.id
  );
}

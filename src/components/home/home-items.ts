// Pure helpers for the Home grid: the merged item shape, filtering and ordering. Client-safe: no runtime imports from src/server.
import { matchesTitleOrYear, TITLE_COLLATOR } from "@/components/library/list";

/** One tile on the Home grid. `key` is needed because movie and series ids can collide. */
export type HomeItem = {
  key: string;
  kind: "movie" | "series";
  id: number;
  title: string;
  year: number | null;
  sortTitle: string;
  /** Not used by the A–Z order. Kept for the planned "Date added" sort. */
  added: string | null;
  href: string;
  posterSrc: string | null;
  badge: { label: string; className: string };
};

export type HomeKind = "all" | "movie" | "series";

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
 * A–Z by sort title. Radarr and Sonarr both lowercase sortTitle and drop a leading "The" or "A" (checked on a live
 * instance: "The Expanse" is "expanse"), so movies and series interleave correctly. Ties go movie before series,
 * then by id. Use with Array.prototype.sort.
 */
export function compareHomeItems(a: HomeItem, b: HomeItem): number {
  return (
    TITLE_COLLATOR.compare(a.sortTitle, b.sortTitle) ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    a.id - b.id
  );
}

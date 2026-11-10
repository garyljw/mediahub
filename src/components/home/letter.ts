// Pure helpers for the A–Z jump bar on Home. Client-safe: no runtime imports from src/server.
import type { HomeItem } from "./home-items";

/** The bar's letters in ascending order: "#" (digits, symbols and empty titles) first, then A to Z. */
export const LETTERS: readonly string[] = ["#", ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))];

/**
 * The first character of a sort title, accents stripped and uppercased. A to Z gives that letter. Anything else (a digit,
 * a symbol, an empty title) gives "#". The sort title already has a leading "The" or "A" dropped, so none is stripped here.
 */
export function letterOf(sortTitle: string): string {
  const base = sortTitle.normalize("NFD").replace(/\p{M}/gu, "");
  const first = base.charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

/**
 * The first item's key for each letter, over the items as they are shown (filtered and sorted). A letter with no items
 * is absent from the map.
 */
export function letterIndex(items: HomeItem[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const item of items) {
    const letter = letterOf(item.sortTitle);
    if (!index.has(letter)) index.set(letter, item.key);
  }
  return index;
}

/** The bar's letters in the order the list is sorted: "#" then A to Z ascending, reversed when descending. */
export function letterOrder(dir: "asc" | "desc"): readonly string[] {
  return dir === "asc" ? LETTERS : [...LETTERS].reverse();
}

/**
 * The letter to jump to when `letter` is chosen: `letter` itself if it has titles, otherwise the next letter in `order`
 * that does. Null when no letter from there on has titles.
 */
export function jumpLetter(letter: string, order: readonly string[], available: ReadonlySet<string>): string | null {
  const start = order.indexOf(letter);
  if (start === -1) return null;
  for (let i = start; i < order.length; i++) {
    const candidate = order[i];
    if (candidate !== undefined && available.has(candidate)) return candidate;
  }
  return null;
}

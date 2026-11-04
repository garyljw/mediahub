// Title collation and the library search rule, shared by Home, the calendar and server merges. Must not import from src/server at runtime.

// Fixed locale so the server render and the browser sort identically. Handles accents ("Éclair" before "Zulu").
export const TITLE_COLLATOR = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * The library search rule, shared by the Home grid: a case-insensitive substring
 * of the title, or of the year. An empty query matches everything.
 */
export function matchesTitleOrYear(item: { title: string; year: number | null }, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (query === "") return true;
  if (item.title.toLowerCase().includes(query)) return true;
  return item.year !== null && String(item.year).includes(query);
}

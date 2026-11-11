// The link from Home to the Add page, carrying the search. Client-safe and pure.
import { normalizeTerm } from "@/components/library/add";
import type { AddKind } from "./add-results";

/** Shorter terms are not searched on the Add page. */
export const MIN_TERM_LENGTH = 2;

/** The Add page's address, with the search text and kind filled in when there is a term to search for. */
export function addHref({ search, kind }: { search: string; kind: AddKind }): string {
  const term = normalizeTerm(search);
  if (term === null) return "/add";
  const params = new URLSearchParams({ q: term });
  if (kind !== "all") params.set("kind", kind);
  return `/add?${params.toString()}`;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The Add page's start text and kind from its address. Anything missing or unknown means no text and "all". */
export function parseAddParams(raw: {
  q?: string | string[] | undefined;
  kind?: string | string[] | undefined;
}): { query: string; kind: AddKind } {
  const kind = firstValue(raw.kind);
  return {
    query: normalizeTerm(firstValue(raw.q) ?? "") ?? "",
    kind: kind === "movie" || kind === "series" ? kind : "all",
  };
}


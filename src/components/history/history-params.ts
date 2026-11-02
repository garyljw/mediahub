// The History page's filters and limit, kept in the URL. Pure and client-safe: the server parses the params and
// the client builds the links, so both use these same rules.

export const HISTORY_TYPES = ["all", "movies", "tv"] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];

/** The event categories a user can tick. Each one maps to Radarr and Sonarr event codes on the server. */
export const HISTORY_EVENT_FILTERS = ["grabbed", "imported", "failed", "deleted", "renamed", "ignored"] as const;
export type HistoryEventFilter = (typeof HISTORY_EVENT_FILTERS)[number];

export const HISTORY_LIMITS = [100, 200, 300, 400, 500] as const;
export const DEFAULT_HISTORY_LIMIT = 100;
export const MAX_HISTORY_LIMIT = 500;
/** How many more events "Show more" adds. */
export const HISTORY_STEP = 100;

export type HistoryParams = {
  type: HistoryType;
  /** In the canonical order of HISTORY_EVENT_FILTERS, without duplicates. Empty means every event. */
  events: HistoryEventFilter[];
  limit: number;
};

export const DEFAULT_HISTORY_PARAMS: HistoryParams = { type: "all", events: [], limit: DEFAULT_HISTORY_LIMIT };

/** Next.js search params: each key is a string, a list of strings (repeated key), or absent. */
export type RawHistorySearchParams = Record<string, string | string[] | undefined>;

function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Reads the URL params. An unknown type gives "all". Unknown event names are dropped, duplicates removed, and the rest
 * kept in canonical order. A limit that isn't one of HISTORY_LIMITS gives the default.
 */
export function parseHistoryParams(raw: RawHistorySearchParams): HistoryParams {
  const typeValue = firstValue(raw.type);
  const type = (HISTORY_TYPES as readonly string[]).includes(typeValue ?? "") ? (typeValue as HistoryType) : "all";

  const eventWords = (Array.isArray(raw.events) ? raw.events : [raw.events])
    .flatMap((value) => (value ?? "").split(","));
  const events = HISTORY_EVENT_FILTERS.filter((event) => eventWords.includes(event));

  const limitNumber = Number(firstValue(raw.limit));
  const limit = (HISTORY_LIMITS as readonly number[]).includes(limitNumber) ? limitNumber : DEFAULT_HISTORY_LIMIT;

  return { type, events, limit };
}

/** The page URL for these params. Defaults are left out, so the plain page has a clean address. */
export function historyHref(params: HistoryParams): string {
  const parts: string[] = [];
  if (params.type !== "all") parts.push(`type=${params.type}`);
  if (params.events.length > 0) parts.push(`events=${params.events.join(",")}`);
  if (params.limit !== DEFAULT_HISTORY_LIMIT) parts.push(`limit=${params.limit}`);
  return parts.length > 0 ? `/history?${parts.join("&")}` : "/history";
}

/** Changing the type starts the list again at the first page. */
export function setHistoryType(params: HistoryParams, type: HistoryType): HistoryParams {
  return { ...params, type, limit: DEFAULT_HISTORY_LIMIT };
}

/** Ticking or unticking one event category. Changing a filter starts the list again at the first page. */
export function toggleHistoryEvent(params: HistoryParams, event: HistoryEventFilter): HistoryParams {
  const wasOn = params.events.includes(event);
  const events = HISTORY_EVENT_FILTERS.filter((candidate) =>
    candidate === event ? !wasOn : params.events.includes(candidate),
  );
  return { ...params, events, limit: DEFAULT_HISTORY_LIMIT };
}

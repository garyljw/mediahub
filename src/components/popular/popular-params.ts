// The Popular page's address options: which service and whether movies or TV. Client-safe: no imports from src/server.

export type PopularMode = "movie" | "tv";

/** What the address asks for. `service` is a TMDB provider id, checked against the offered services by the page. */
export type PopularParams = { service: number | null; mode: PopularMode };

type Raw = { service?: string | string[] | undefined; kind?: string | string[] | undefined };

/** Reads the address. Anything that isn't a plain provider id or "tv" falls back to the default (no service, movies). */
export function parsePopularParams(raw: Raw): PopularParams {
  const service = typeof raw.service === "string" && /^[1-9]\d{0,8}$/.test(raw.service) ? Number(raw.service) : null;
  return { service, mode: raw.kind === "tv" ? "tv" : "movie" };
}

/** The address for a service and mode, kept relative so it stays on the Popular page. */
export function popularHref(service: number, mode: PopularMode): string {
  return `/popular?service=${service}&kind=${mode}`;
}

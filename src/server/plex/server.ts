import "server-only";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { z } from "zod";
import { kindError, PlexRequestError, transportError } from "./errors";
import { getPlexDataClientId } from "./data-connection";

// Calls to a Plex Media Server (not plex.tv), made with the legacy Plex token from the data connection. Every reply
// is checked with Zod and only the fields below are kept. The token is sent only in the X-Plex-Token header.
//
// Two ways to reach a server address:
//   - plain http (pinAddress null): an ordinary fetch.
//   - pinned https (pinAddress set): the plex.direct name is still used for TLS (certificate checking stays on),
//     but the DNS lookup always returns pinAddress. Gary's router refuses to look up *.plex.direct names, so the
//     lookup is pinned to the address plex.tv listed for the server.

const PLEX_PRODUCT = "MediaHub";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024;
// A whole library section (every item, with its guids) is much bigger than the default cap.
const SECTION_ITEMS_MAX_BYTES = 16 * 1024 * 1024;

/** The address to call, and the IP to pin its lookup to (https plex.direct only). */
export type ServerConnection = { url: string; pinAddress: string | null };

const IdentitySchema = z.object({
  MediaContainer: z.object({ machineIdentifier: z.string().min(1) }),
});
// Only the fields the watched status needs. Zod drops every other key on each item (title, ratingKey, duration, ...).
// Exported so the merge tests can run fixtures through the same schema. Each item becomes a PlexSectionItem.
export const SectionItemsSchema = z
  .object({
    MediaContainer: z.object({
      Metadata: z
        .array(
          z.object({
            Guid: z.array(z.object({ id: z.string() })).nullish(),
            viewCount: z.number().nullish(),
            viewOffset: z.number().nullish(),
            leafCount: z.number().nullish(),
            viewedLeafCount: z.number().nullish(),
            ratingKey: z.string().nullish(),
          }),
        )
        .nullish(),
    }),
  })
  .transform((reply): PlexSectionItem[] =>
    (reply.MediaContainer.Metadata ?? []).map((item) => ({
      guids: (item.Guid ?? []).map((guid) => guid.id),
      viewCount: item.viewCount ?? 0,
      viewOffset: item.viewOffset ?? 0,
      leafCount: item.leafCount ?? 0,
      viewedLeafCount: item.viewedLeafCount ?? 0,
      ratingKey: item.ratingKey ?? null,
    })),
  );
const SectionsSchema = z.object({
  MediaContainer: z.object({
    Directory: z
      .array(z.object({ key: z.string(), type: z.string(), title: z.string() }))
      .nullish(),
  }),
});

/** Makes the DNS lookup answer with one fixed address. Both callback shapes are handled (see the Node lookup option). */
export function pinnedLookup(pinAddress: string): LookupFunction {
  const family = isIP(pinAddress);
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, [{ address: pinAddress, family }]);
    } else {
      callback(null, pinAddress, family);
    }
  };
}

function serverHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Plex-Client-Identifier": getPlexDataClientId(),
    "X-Plex-Product": PLEX_PRODUCT,
  };
  if (token) headers["X-Plex-Token"] = token;
  return headers;
}

/** Plain http: fetch with no redirects. The body is capped at maxBytes, both by Content-Length and by its real length. */
async function getPlain(
  step: string,
  url: URL,
  method: PlexMethod,
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes: number,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { method, headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw transportError(step, error);
  }
  if (!response.ok) throw new PlexRequestError(`${step} request failed: HTTP ${response.status}`, "http", response.status);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw kindError(step, "invalid");
  // Read the body in chunks and stop as soon as it passes the cap, so an oversized reply is never fully buffered.
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const reader = response.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          throw kindError(step, "invalid");
        }
        chunks.push(value);
      }
    }
  } catch (error) {
    if (error instanceof PlexRequestError) throw error;
    throw transportError(step, error);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Pinned https: node:https with the lookup fixed to pinAddress. A redirect (3xx) counts as an HTTP failure. */
function getPinned(
  step: string,
  url: URL,
  method: PlexMethod,
  pinAddress: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let settled = false;
    // Settles the promise once and tears the request down, so later events can't reject again or keep the socket open.
    const fail = (error: PlexRequestError) => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(error);
    };
    // node:https reports a signal abort as AbortError, so a timeout is read from the signal itself.
    const failTransport = (error: unknown) => fail(signal.aborted ? kindError(step, "timeout") : transportError(step, error));

    const request = httpsRequest(
      url,
      { method, headers, lookup: pinnedLookup(pinAddress), signal },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status > 299) {
          fail(new PlexRequestError(`${step} request failed: HTTP ${status}`, "http", status));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size > maxBytes) {
            fail(new PlexRequestError(`${step} response was not as expected`, "invalid"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        response.on("error", failTransport);
      },
    );
    request.on("error", failTransport);
    request.end();
  });
}

type PlexMethod = "GET" | "POST" | "PUT" | "DELETE";

type RequestOptions = { conn: ServerConnection; path: string; token?: string; timeoutMs?: number; maxBytes?: number };

/**
 * Sends one request to the server and returns the raw body text. Headers, timeout, no redirects and the body cap are the
 * same for every method. The path must already have its segments encoded and its query built.
 */
async function requestBody(step: string, method: PlexMethod, options: RequestOptions): Promise<string> {
  const url = new URL(options.path, options.conn.url);
  const headers = serverHeaders(options.token);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;

  return options.conn.pinAddress === null
    ? getPlain(step, url, method, headers, timeoutMs, maxBytes)
    : getPinned(step, url, method, options.conn.pinAddress, headers, timeoutMs, maxBytes);
}

/** Parses a reply body as JSON and checks it with the schema. Errors name the step and the kind only. */
function parseReply<T>(step: string, schema: z.ZodType<T>, body: string): T {
  let json: unknown;
  try {
    json = JSON.parse(body) as unknown;
  } catch {
    throw kindError(step, "invalid");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new PlexRequestError(`${step} response was not as expected`, "invalid");
  return parsed.data;
}

/**
 * The one place every Plex Media Server GET goes through: headers, timeout, no redirects, and Zod validation.
 * Errors name the step and the kind or status only.
 */
async function plexServerFetch<T>(step: string, schema: z.ZodType<T>, options: RequestOptions): Promise<T> {
  return parseReply(step, schema, await requestBody(step, "GET", options));
}

/**
 * Sends a write (POST, PUT or DELETE) with no body. A write that returns nothing it needs skips the JSON parse, so an
 * empty reply is fine. Pass a schema to check a reply that is needed (such as a new collection's key).
 */
function plexServerSend(step: string, method: Exclude<PlexMethod, "GET">, options: RequestOptions): Promise<void>;
function plexServerSend<T>(
  step: string,
  method: Exclude<PlexMethod, "GET">,
  options: RequestOptions,
  schema: z.ZodType<T>,
): Promise<T>;
async function plexServerSend<T>(
  step: string,
  method: Exclude<PlexMethod, "GET">,
  options: RequestOptions,
  schema?: z.ZodType<T>,
): Promise<T | void> {
  const body = await requestBody(step, method, options);
  if (schema) return parseReply(step, schema, body);
}

/** The server's machineIdentifier. Needs no token, so it can check an address before the token is sent there. */
export async function getServerIdentity(conn: ServerConnection, options: { timeoutMs?: number } = {}): Promise<string> {
  const reply = await plexServerFetch("Plex server identity", IdentitySchema, {
    conn,
    path: "/identity",
    timeoutMs: options.timeoutMs,
  });
  return reply.MediaContainer.machineIdentifier;
}

/** The server's libraries (key, type such as movie or show, and title). */
export async function getLibrarySections(
  conn: ServerConnection,
  token: string,
): Promise<{ key: string; type: string; title: string }[]> {
  const reply = await plexServerFetch("Plex library sections", SectionsSchema, {
    conn,
    path: "/library/sections",
    token,
  });
  return (reply.MediaContainer.Directory ?? []).map(({ key, type, title }) => ({ key, type, title }));
}

/** One library item, reduced to the guids and watch counts the watched status uses. */
export type PlexSectionItem = {
  /** Guids such as "tmdb://603" or "imdb://tt0133093", exactly as Plex lists them. */
  guids: string[];
  /** Movies: how many times it was watched. 0 when never watched. */
  viewCount: number;
  /** Movies: the resume position in ms. 0 when not started. */
  viewOffset: number;
  /** Shows: the number of episodes. */
  leafCount: number;
  /** Shows: the number of episodes watched. */
  viewedLeafCount: number;
  /** Plex's id for the item, used to load a show's episodes. Never sent to the browser. */
  ratingKey: string | null;
};

// One episode from a show's allLeaves reply. Zod drops every other key (title, Media, ratingKey, ...).
export const EpisodeItemsSchema = z
  .object({
    MediaContainer: z.object({
      Metadata: z
        .array(
          z.object({
            parentIndex: z.number().nullish(),
            index: z.number().nullish(),
            viewCount: z.number().nullish(),
            viewOffset: z.number().nullish(),
            Guid: z.array(z.object({ id: z.string() })).nullish(),
          }),
        )
        .nullish(),
    }),
  })
  .transform((reply): PlexEpisodeItem[] =>
    (reply.MediaContainer.Metadata ?? []).map((item) => ({
      guids: (item.Guid ?? []).map((guid) => guid.id),
      season: integerOrNull(item.parentIndex),
      episode: integerOrNull(item.index),
      viewCount: item.viewCount ?? 0,
      viewOffset: item.viewOffset ?? 0,
    })),
  );

function integerOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** One episode of a show, reduced to the guids, numbers and watch counts the watched status uses. */
export type PlexEpisodeItem = {
  /** Guids such as "tvdb://4566247" or "tmdb://919274", exactly as Plex lists them. */
  guids: string[];
  /** The season number (Plex's parentIndex), or null when Plex lists none. */
  season: number | null;
  /** The episode number (Plex's index), or null when Plex lists none. */
  episode: number | null;
  /** How many times it was watched. 0 when never watched. */
  viewCount: number;
  /** The resume position in ms. 0 when not started. */
  viewOffset: number;
};

/**
 * Every item in one library section, with its guids. Plex sends the whole section in one reply (no paging), so the
 * body cap is much larger than the default. The section key is encoded into the path.
 */
export async function getSectionItems(
  conn: ServerConnection,
  token: string,
  sectionKey: string,
): Promise<PlexSectionItem[]> {
  return plexServerFetch("Plex library items", SectionItemsSchema, {
    conn,
    path: `/library/sections/${encodeURIComponent(sectionKey)}/all?includeGuids=1`,
    token,
    timeoutMs: 15_000,
    maxBytes: SECTION_ITEMS_MAX_BYTES,
  });
}

/**
 * Every episode of one show (its ratingKey from the section listing), with guids and watch counts. The ratingKey is
 * encoded into the path.
 */
export async function getShowEpisodes(conn: ServerConnection, token: string, ratingKey: string): Promise<PlexEpisodeItem[]> {
  return plexServerFetch("Plex show episodes", EpisodeItemsSchema, {
    conn,
    path: `/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves?includeGuids=1`,
    token,
    timeoutMs: 15_000,
    maxBytes: SECTION_ITEMS_MAX_BYTES,
  });
}

// Focus collections (Movie Focus, TV Focus) are plain Plex collections MediaHub keeps in step with its lists. Each
// call below is one step of that sync (see server/focus/plex-sync.ts). Every path segment is encoded and every query is
// built with URLSearchParams. A reply is checked only for the keys the sync uses.

const RatingKey = z.string().regex(/^\d+$/);
const CreatedCollectionSchema = z.object({
  MediaContainer: z.object({ Metadata: z.array(z.object({ ratingKey: RatingKey })).min(1) }),
});
const CollectionChildrenSchema = z.object({
  MediaContainer: z.object({ Metadata: z.array(z.object({ ratingKey: RatingKey })).nullish() }),
});

/** Plex's collection type for a movie collection (1) or a show collection (2). */
const COLLECTION_TYPE = { movie: "1", series: "2" } as const;
/** Plex's sort value for a collection that keeps its own order. */
const CUSTOM_COLLECTION_SORT = "2";

/** True for a reply with HTTP status 404, the only status the collection calls treat as "not there". */
function isNotFound(error: unknown): boolean {
  return error instanceof PlexRequestError && error.kind === "http" && error.status === 404;
}

/** Creates an empty collection in a library section and returns its ratingKey. */
export async function createCollection(
  conn: ServerConnection,
  token: string,
  { kind, title, sectionKey }: { kind: "movie" | "series"; title: string; sectionKey: string },
): Promise<string> {
  const query = new URLSearchParams({ type: COLLECTION_TYPE[kind], title, smart: "0", sectionId: sectionKey });
  const reply = await plexServerSend("Plex collection create", "POST", { conn, token, path: `/library/collections?${query}` }, CreatedCollectionSchema);
  const created = reply.MediaContainer.Metadata[0];
  if (!created) throw kindError("Plex collection create", "invalid");
  return created.ratingKey;
}

/**
 * The ratingKeys of a collection's items, in collection order. Null when the collection no longer exists (HTTP 404),
 * so the caller can make a new one.
 */
export async function getCollectionItemKeys(conn: ServerConnection, token: string, collectionKey: string): Promise<string[] | null> {
  try {
    const reply = await plexServerFetch("Plex collection items", CollectionChildrenSchema, {
      conn,
      token,
      path: `/library/collections/${encodeURIComponent(collectionKey)}/children`,
      maxBytes: SECTION_ITEMS_MAX_BYTES,
    });
    return (reply.MediaContainer.Metadata ?? []).map((item) => item.ratingKey);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Adds one item to a collection. Plex takes the item as a server:// uri that names this server's machine id. */
export async function addCollectionItem(
  conn: ServerConnection,
  token: string,
  { collectionKey, machineId, itemKey }: { collectionKey: string; machineId: string; itemKey: string },
): Promise<void> {
  const uri = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${itemKey}`;
  const query = new URLSearchParams({ uri });
  await plexServerSend("Plex collection add item", "PUT", {
    conn,
    token,
    path: `/library/collections/${encodeURIComponent(collectionKey)}/items?${query}`,
  });
}

/** Removes one item from a collection. The item stays in the library. */
export async function removeCollectionItem(conn: ServerConnection, token: string, collectionKey: string, itemKey: string): Promise<void> {
  await plexServerSend("Plex collection remove item", "DELETE", {
    conn,
    token,
    path: `/library/collections/${encodeURIComponent(collectionKey)}/items/${encodeURIComponent(itemKey)}`,
  });
}

/** Moves one item to sit after another item, or to the front when after is null. */
export async function moveCollectionItem(
  conn: ServerConnection,
  token: string,
  collectionKey: string,
  itemKey: string,
  after: string | null,
): Promise<void> {
  const query = after === null ? "" : `?${new URLSearchParams({ after })}`;
  await plexServerSend("Plex collection move item", "PUT", {
    conn,
    token,
    path: `/library/collections/${encodeURIComponent(collectionKey)}/items/${encodeURIComponent(itemKey)}/move${query}`,
  });
}

/** Sets a collection to keep its own custom order, so the moves above take effect. */
export async function setCollectionCustomOrder(conn: ServerConnection, token: string, collectionKey: string): Promise<void> {
  const query = new URLSearchParams({ collectionSort: CUSTOM_COLLECTION_SORT });
  await plexServerSend("Plex collection sort", "PUT", {
    conn,
    token,
    path: `/library/collections/${encodeURIComponent(collectionKey)}/prefs?${query}`,
  });
}

/**
 * Pins a collection to the owner's Plex Home: the pin call, then a move of its row to the top of the section's rows.
 * The row's identifier is "custom.collection.{section}.{collection}", encoded as one path segment.
 */
export async function pinCollectionToHome(conn: ServerConnection, token: string, sectionKey: string, collectionKey: string): Promise<void> {
  const pinQuery = new URLSearchParams({ metadataItemId: collectionKey, promotedToOwnHome: "1" });
  await plexServerSend("Plex collection pin", "POST", {
    conn,
    token,
    path: `/hubs/sections/${encodeURIComponent(sectionKey)}/manage?${pinQuery}`,
  });

  const identifier = `custom.collection.${sectionKey}.${collectionKey}`;
  await plexServerSend("Plex collection hub move", "PUT", {
    conn,
    token,
    path: `/hubs/sections/${encodeURIComponent(sectionKey)}/manage/${encodeURIComponent(identifier)}/move`,
  });
}

/** Deletes a collection. Its items stay in the library. A collection that is already gone counts as deleted. */
export async function deleteCollection(conn: ServerConnection, token: string, collectionKey: string): Promise<void> {
  try {
    await plexServerSend("Plex collection delete", "DELETE", {
      conn,
      token,
      path: `/library/collections/${encodeURIComponent(collectionKey)}`,
    });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

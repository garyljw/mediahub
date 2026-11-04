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
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw kindError(step, "invalid");
  }
}

/** Pinned https: node:https with the lookup fixed to pinAddress. A redirect (3xx) counts as an HTTP failure. */
function getPinned(
  step: string,
  url: URL,
  pinAddress: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes: number,
): Promise<unknown> {
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
      { method: "GET", headers, lookup: pinnedLookup(pinAddress), signal },
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
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
          } catch {
            reject(kindError(step, "invalid"));
          }
        });
        response.on("error", failTransport);
      },
    );
    request.on("error", failTransport);
    request.end();
  });
}

/**
 * The one place every Plex Media Server request goes through: headers, timeout, no redirects, and Zod validation.
 * Errors name the step and the kind or status only.
 */
async function plexServerFetch<T>(
  step: string,
  schema: z.ZodType<T>,
  options: { conn: ServerConnection; path: string; token?: string; timeoutMs?: number; maxBytes?: number },
): Promise<T> {
  const url = new URL(options.path, options.conn.url);
  const headers = serverHeaders(options.token);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;

  const json =
    options.conn.pinAddress === null
      ? await getPlain(step, url, headers, timeoutMs, maxBytes)
      : await getPinned(step, url, options.conn.pinAddress, headers, timeoutMs, maxBytes);

  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new PlexRequestError(`${step} response was not as expected`, "invalid");
  return parsed.data;
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

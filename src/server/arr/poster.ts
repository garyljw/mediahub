import "server-only";
import { z } from "zod";
import { ArrRequestError, arrRequest } from "./request";

// Shared by the Radarr and Sonarr posters and the TMDB lookup poster: size cap and JPEG check for a fetched image.
/** Largest poster we accept. Radarr's 250px thumbnail is far smaller, so anything bigger is not what we asked for. */
export const MAX_POSTER_BYTES = 2 * 1024 * 1024;

/**
 * Reads a body into memory, up to `max` bytes. Returns null as soon as it goes over and cancels the
 * rest, so an oversized response never gets fully buffered on the NAS.
 */
export async function readCapped(body: ReadableStream<Uint8Array> | null | undefined, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Every JPEG starts with these bytes. Anything else (e.g. a proxy's HTML login page) is not served as a poster. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Fetches one cover image from Radarr or Sonarr as JPEG bytes. `get` makes the typed client call (the caller
 * picks the fixed poster file) and is run inside arrRequest, so the timeout covers the body read too. On an
 * error response the body is undefined and arrRequest throws on the status. `label` names the request in errors.
 */
export async function fetchPosterBytes(
  label: string,
  get: (signal: AbortSignal) => Promise<{ data?: ReadableStream<Uint8Array> | null; response: Response }>,
): Promise<Uint8Array<ArrayBuffer>> {
  const data = await arrRequest(label, async (signal) => {
    const { data: body, response } = await get(signal);
    return { data: await readCapped(body, MAX_POSTER_BYTES), response };
  });
  if (!data || !isJpeg(data)) {
    throw new ArrRequestError(`${label} response was not a usable image`, "invalid");
  }
  return data;
}

/**
 * Fetches one fixed image URL as JPEG bytes. The fetch refuses redirects and sends no headers, so the caller
 * must pass a URL it built itself. Used for TMDB and TVDB posters. `label` names the request in errors.
 */
export async function fetchFixedJpeg(label: string, url: string): Promise<Uint8Array<ArrayBuffer>> {
  return fetchPosterBytes(label, async (signal) => {
    const response = await fetch(url, { redirect: "error", signal });
    // Only read the body of a good response. For a failed one, drop the body so the socket is released.
    // A cancel error is ignored: the status is what gets reported.
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // Ignored on purpose, see above.
      }
      return { data: undefined, response };
    }
    return { data: response.body, response };
  });
}

/** Poster ids are positive 32-bit integers written without leading zeros. */
const posterId = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .transform(Number)
  .refine((n) => n <= 2147483647);

/**
 * Builds the poster response for a route: validates the raw id, fetches the poster, and maps failures.
 * An invalid id gets a 400, an ArrRequestError gets a fixed 502 body with one `[poster]` log line
 * (the upstream message stays out of the body), and anything else is rethrown. Routes call this after
 * their own requireRole check.
 */
export async function servePosterResponse(
  rawId: string,
  fetchPoster: (id: number) => Promise<Uint8Array<ArrayBuffer>>,
): Promise<Response> {
  const parsed = posterId.safeParse(rawId);
  if (!parsed.success) return Response.json({ error: "invalid id" }, { status: 400 });

  try {
    const bytes = await fetchPoster(parsed.data);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ArrRequestError) {
      // Log for operators. The upstream message stays out of the response body.
      console.error(`[poster] ${error.message}`);
      return Response.json({ error: "poster unavailable" }, { status: 502 });
    }
    throw error;
  }
}

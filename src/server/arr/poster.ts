import "server-only";

// Shared by the Radarr movie poster and the TMDB lookup poster: size cap and JPEG check for a fetched image.
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

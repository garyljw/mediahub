import "server-only";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { releasesReplySchema, type Release } from "./releases";

const RELEASES_URL = "https://api.github.com/repos/garyljw/mediahub/releases?per_page=30";
const USER_AGENT = "MediaHub-Updater";
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** Lists the newest releases. Throws on a network error, a non-200 reply or a reply that doesn't parse. */
export async function fetchReleases(): Promise<Release[]> {
  const response = await fetch(RELEASES_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
  return releasesReplySchema.parse(await response.json());
}

/**
 * Streams `url` to `dest` and computes its SHA-256 while writing. Aborts above `maxBytes`.
 * Only https URLs are allowed, including after redirects. Errors never include the URL (it can carry a query string).
 */
export async function download(
  url: string,
  dest: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ sha256: string; size: number }> {
  if (!url.startsWith("https://")) throw new Error("Refusing a download that is not https.");
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]) : AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
  if (!response.url.startsWith("https://")) throw new Error("Refusing a redirect that is not https.");
  if (!response.body) throw new Error("Download has no body.");

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error("Download is larger than the update manifest allows.");

  const hash = createHash("sha256");
  let size = 0;
  const handle = await open(dest, "w");
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Download is larger than the update manifest allows.");
      hash.update(value);
      await handle.write(value);
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest("hex"), size };
}

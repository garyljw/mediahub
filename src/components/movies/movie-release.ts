// Pure "pick a release" display logic. Must not import from src/server at runtime.
import type { ReleaseRow } from "@/server/arr/releases";
import { formatCount, formatSize } from "@/components/library/format";

const PROTOCOL_LABEL: Record<ReleaseRow["protocol"], string | null> = {
  usenet: "Usenet",
  torrent: "Torrent",
  unknown: null,
};

/** Which releases the pick dialog shows. "all" includes releases whose protocol Radarr didn't report. */
export type ProtocolFilter = "all" | "usenet" | "torrent";

/** The filter dropdown's options, in order. */
export const PROTOCOL_FILTERS: { value: ProtocolFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "usenet", label: "Usenet" },
  { value: "torrent", label: "Torrent" },
];

/** The dropdown's value as a ProtocolFilter, or "all" for anything unexpected. */
export function parseProtocolFilter(value: string): ProtocolFilter {
  return PROTOCOL_FILTERS.find((option) => option.value === value)?.value ?? "all";
}

/** Pure: the releases that match the protocol filter, in the order given (Radarr's best-first order). */
export function filterReleases(releases: ReleaseRow[], protocol: ProtocolFilter): ReleaseRow[] {
  if (protocol === "all") return releases;
  return releases.filter((release) => release.protocol === protocol);
}

/** "3h", "2d", "<1h" or an em dash. Hours under 48 show as hours, then whole days. */
export function formatAge(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return "—";
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.floor(hours)}h`;
  return `${formatCount(Math.floor(hours / 24))}d`;
}

/** "12/3" (seeders/leechers). A missing side shows "?", and both missing shows an em dash. */
export function formatPeers(seeders: number | null, leechers: number | null): string {
  if (seeders === null && leechers === null) return "—";
  const seeds = seeders === null ? "?" : formatCount(seeders);
  const leeches = leechers === null ? "?" : formatCount(leechers);
  return `${seeds}/${leeches}`;
}

/** The status line after the download client accepts a grab. Radarr has only queued it, so "sent" is the right word. */
export function grabbedMessage(title: string): string {
  return `Sent "${title}" to the download client.`;
}

/**
 * "No releases found.", "1 release", "12 releases", or "Showing the top 200 of 350 releases". With a protocol,
 * it names it: "No torrent releases found.", "12 Usenet releases".
 */
export function releaseCountLine(shown: number, total: number, protocol: ProtocolFilter = "all"): string {
  const kind = protocol === "usenet" ? "Usenet " : protocol === "torrent" ? "torrent " : "";
  if (total === 0) return `No ${kind}releases found.`;
  if (shown === total) return `${formatCount(total)} ${kind}${total === 1 ? "release" : "releases"}`;
  return `Showing the top ${formatCount(shown)} of ${formatCount(total)} ${kind}releases`;
}

/**
 * The one-line summary under a release title in the pick dialog, e.g.
 * ["Bluray-2160p", "13.0 GB", "30h old", "Usenet", "NZBgeek", "Score 120"]. Torrents add "12/3 peers".
 * Each part names itself ("old", "peers", "Score"), because the list has no column headers. Missing values
 * are left out rather than shown as dashes, so the line stays short. The score is always shown, 0 included.
 */
export function releaseDetails(release: ReleaseRow): string[] {
  const parts: string[] = [];
  if (release.quality !== null) parts.push(release.quality);
  if (release.size > 0) parts.push(formatSize(release.size));
  if (release.ageHours !== null) parts.push(`${formatAge(release.ageHours)} old`);
  const protocol = PROTOCOL_LABEL[release.protocol];
  if (protocol !== null) parts.push(protocol);
  if (release.indexer !== null) parts.push(release.indexer);
  if (release.protocol === "torrent" && (release.seeders !== null || release.leechers !== null)) {
    parts.push(`${formatPeers(release.seeders, release.leechers)} peers`);
  }
  parts.push(`Score ${formatCount(release.customFormatScore)}`);
  return parts;
}

// Pure "pick a release" display logic, shared by the Movies and TV pick dialogs. Must not import from src/server at runtime.
import type { ReleaseRow, ReleaseTotals } from "@/server/arr/releases";
import { formatCount, formatSize } from "@/components/library/format";

const PROTOCOL_LABEL: Record<ReleaseRow["protocol"], string | null> = {
  usenet: "Usenet",
  torrent: "Torrent",
  unknown: null,
};

/** The search action's result: the rows and totals, or an error for the dialog to show. */
export type ReleaseSearchResult = { ok: true; releases: ReleaseRow[]; totals: ReleaseTotals } | { ok: false; error: string };

/** The grab action's result: the release's title when it was sent, or an error for the dialog to show. */
export type GrabResult = { ok: true; title: string } | { ok: false; error: string };

/** Which releases the pick dialog shows. "all" includes releases whose protocol the app didn't report. */
export type ProtocolFilter = "all" | "usenet" | "torrent";

/** The filter dropdown's options, in order. */
export const PROTOCOL_FILTERS: { value: ProtocolFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "usenet", label: "Usenet" },
  { value: "torrent", label: "Torrent" },
];

/** The dropdown's value as a ProtocolFilter, or "all" for anything unexpected (including null). */
export function parseProtocolFilter(value: string | null): ProtocolFilter {
  return PROTOCOL_FILTERS.find((option) => option.value === value)?.value ?? "all";
}

/** Which releases of a season search the dialog shows: full-season packs, single episodes, or both. */
export type PackFilter = "packs" | "episodes" | "all";

/** The season dialog's pack dropdown options, in order. */
export const PACK_FILTERS: { value: PackFilter; label: string }[] = [
  { value: "packs", label: "Season packs" },
  { value: "episodes", label: "Episodes" },
  { value: "all", label: "All" },
];

/** The dropdown's value as a PackFilter. Season packs come first, so anything unexpected (including null) means "packs". */
export function parsePackFilter(value: string | null): PackFilter {
  return PACK_FILTERS.find((option) => option.value === value)?.value ?? "packs";
}

/** How the release list is ordered. "app" is the app's own best-match order. The other keys always sort the same way. */
export type ReleaseSort = "app" | "quality" | "size" | "age" | "seeders";

/** The sort dropdown's options, in order. */
export const RELEASE_SORTS: { value: ReleaseSort; label: string }[] = [
  { value: "app", label: "Best match" },
  { value: "quality", label: "Quality" },
  { value: "size", label: "Size" },
  { value: "age", label: "Age" },
  { value: "seeders", label: "Seeders" },
];

/** The dropdown's value as a ReleaseSort. Best match comes first, so anything unexpected (including null) means "app". */
export function parseReleaseSort(value: string | null): ReleaseSort {
  return RELEASE_SORTS.find((option) => option.value === value)?.value ?? "app";
}

/** Pure: the releases that match the filters, in the order given (the app's best-first order). */
export function filterReleases(
  releases: ReleaseRow[],
  protocol: ProtocolFilter,
  pack: PackFilter = "all",
  hideNotInProfile = false,
): ReleaseRow[] {
  if (protocol === "all" && pack === "all" && !hideNotInProfile) return releases;
  return releases.filter(
    (release) =>
      (protocol === "all" || release.protocol === protocol) &&
      (pack === "all" || (pack === "packs") === release.fullSeason) &&
      !(hideNotInProfile && release.notInProfile),
  );
}

/** Peers as one number for sorting: seeders count for much more than leechers. Missing counts count as 0. */
function peerScore(release: ReleaseRow): number {
  return (release.seeders ?? 0) * 1_000_000 + (release.leechers ?? 0);
}

/**
 * Pure: the releases in the chosen order, as a new array (the input is never changed). Equal keys keep the app's
 * order. "app" returns the input array itself. Fixed directions: best quality, largest size, newest age and most
 * peers come first. A release with no age sorts last by age. A release that isn't a torrent (no peer counts) sorts
 * last by seeders.
 */
export function sortReleases(releases: ReleaseRow[], sort: ReleaseSort): ReleaseRow[] {
  if (sort === "app") return releases;
  // Array.prototype.sort is stable, so equal keys keep the order they came in.
  const copy = [...releases];
  switch (sort) {
    case "quality":
      return copy.sort((a, b) => b.qualityWeight - a.qualityWeight);
    case "size":
      return copy.sort((a, b) => b.size - a.size);
    case "age":
      return copy.sort((a, b) => {
        if (a.ageHours === null || b.ageHours === null) return (a.ageHours === null ? 1 : 0) - (b.ageHours === null ? 1 : 0);
        return a.ageHours - b.ageHours;
      });
    case "seeders":
      return copy.sort((a, b) => {
        const aPeers = a.seeders !== null || a.leechers !== null;
        const bPeers = b.seeders !== null || b.leechers !== null;
        if (aPeers !== bPeers) return aPeers ? -1 : 1;
        return peerScore(b) - peerScore(a);
      });
  }
}

/** The total for one protocol and pack filter, from the search totals. Episodes are the usable releases that aren't packs. */
export function releaseTotal(totals: ReleaseTotals, protocol: ProtocolFilter, pack: PackFilter): number {
  if (pack === "packs") return totals.packs[protocol];
  if (pack === "episodes") return totals[protocol] - totals.packs[protocol];
  return totals[protocol];
}

/** Where a dialog kind remembers its protocol choice. */
export function protocolChoiceKey(kind: "movie" | "season" | "episode"): string {
  return `mediahub.releaseDialog.${kind}.protocol`;
}

/** Where the season dialog remembers its pack choice. */
export const PACK_CHOICE_KEY = "mediahub.releaseDialog.season.pack";

/** Where every dialog kind remembers its sort choice. */
export const SORT_CHOICE_KEY = "mediahub.releaseDialog.sort";

/** Where every dialog kind remembers whether qualities outside the profile are hidden. */
export const HIDE_NOT_IN_PROFILE_KEY = "mediahub.releaseDialog.hideNotInProfile";

/** Remembered dialog choices. Storage can be missing or throw (private mode, blocked site data), so failures are ignored. */
export function readChoice(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeChoice(key: string, value: string): void {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // Not remembered this time. The dialog still works.
  }
}

/** Two digits, zero-padded: 5 becomes "05". Hand-written, not Intl, for the same reason as the other helpers here. */
export function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** "S02E05": a season and episode number, each zero-padded to two digits. */
export function episodeCode(season: number, episode: number): string {
  return `S${twoDigits(season)}E${twoDigits(episode)}`;
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

/** The status line after the download client accepts a grab. The app has only queued it, so "sent" is the right word. */
export function grabbedMessage(title: string): string {
  return `Sent "${title}" to the download client.`;
}

/** The noun for each pack filter, singular and plural. */
const RELEASE_NOUN: Record<PackFilter, { one: string; many: string }> = {
  all: { one: "release", many: "releases" },
  packs: { one: "season pack", many: "season packs" },
  episodes: { one: "episode release", many: "episode releases" },
};

/**
 * "No releases found.", "1 release", "12 releases", or "Showing the top 200 of 350 releases". With a protocol,
 * it names it: "No torrent releases found.", "12 Usenet releases". The pack filter changes the noun:
 * "No season packs found.", "1 Usenet season pack", "Showing the top 1,000 of 1,200 torrent season packs".
 */
export function releaseCountLine(shown: number, total: number, protocol: ProtocolFilter = "all", pack: PackFilter = "all"): string {
  const kind = protocol === "usenet" ? "Usenet " : protocol === "torrent" ? "torrent " : "";
  const noun = RELEASE_NOUN[pack];
  if (total === 0) return `No ${kind}${noun.many} found.`;
  if (shown === total) return `${formatCount(total)} ${kind}${total === 1 ? noun.one : noun.many}`;
  return `Showing the top ${formatCount(shown)} of ${formatCount(total)} ${kind}${noun.many}`;
}

/**
 * The one-line summary under a release title in the pick dialog, e.g.
 * ["Bluray-2160p", "13.0 GB", "30h old", "Usenet", "NZBgeek", "Score 120"]. Torrents add "12/3 peers".
 * A TV release starts with its episodes, e.g. "Season pack" or "S02E05-E06". Each part names itself ("old",
 * "peers", "Score"), because the list has no column headers. Missing values are left out rather than shown as
 * dashes, so the line stays short. The score is always shown, 0 included.
 */
export function releaseDetails(release: ReleaseRow): string[] {
  const parts: string[] = [];
  if (release.episodes !== null) parts.push(release.episodes);
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

import "server-only";
import { isIP } from "node:net";
import type { PlexConnection } from "./client";

// Turns the addresses plex.tv lists for a server into the ones MediaHub will try. Pure: no network, no storage.
// Relay and non-local addresses are skipped (Gary's Plex is LAN only). Pinned https is listed before plain http.

export type ServerCandidate = {
  /** Stable within one list, e.g. "pinned-0" or "http-1". The save step looks the candidate up by this id. */
  id: string;
  label: string;
  url: string;
  /** The IP to pin the lookup to (pinned https), or null for plain http. */
  pinAddress: string | null;
};

const PLEX_DIRECT_SUFFIX = ".plex.direct";

/** What a label says about the server: its name. */
export type ServerLabel = { serverName: string };

function hostAndPort(address: string, port: number): string {
  return isIP(address) === 6 ? `[${address}]:${port}` : `${address}:${port}`;
}

function labelPrefix({ serverName }: ServerLabel): string {
  return `${serverName} · `;
}

/** A pinned https candidate: the plex.direct name, with the lookup fixed to the listed address. */
function pinnedCandidate(connection: PlexConnection, named: ServerLabel): ServerCandidate | null {
  if (connection.protocol !== "https" || isIP(connection.address) === 0) return null;
  let uri: URL;
  try {
    uri = new URL(connection.uri);
  } catch {
    return null;
  }
  if (uri.protocol !== "https:" || !uri.hostname.endsWith(PLEX_DIRECT_SUFFIX)) return null;
  // The label shows address:port, so the URL actually used must be on that same port.
  if (Number(uri.port || 443) !== connection.port) return null;
  return {
    id: "",
    label: `${labelPrefix(named)}https · ${hostAndPort(connection.address, connection.port)}`,
    url: connection.uri,
    pinAddress: connection.address,
  };
}

/** A plain http candidate for a local IPv4 address. IPv6 is not built as plain http. */
function plainCandidate(connection: PlexConnection, named: ServerLabel): ServerCandidate | null {
  if (connection.IPv6 || isIP(connection.address) !== 4) return null;
  return {
    id: "",
    label: `${labelPrefix(named)}http · ${hostAndPort(connection.address, connection.port)} (not encrypted)`,
    url: `http://${connection.address}:${connection.port}`,
    pinAddress: null,
  };
}

/**
 * The addresses to try for one server, pinned https first, then plain http. Duplicates are removed. Ids are index-based
 * within this server; the caller adds a server prefix so ids stay unique across servers.
 */
export function buildCandidates(connections: PlexConnection[], named: ServerLabel): ServerCandidate[] {
  const local = connections.filter((connection) => connection.local && !connection.relay);
  const pinned = local.map((c) => pinnedCandidate(c, named)).filter((c): c is ServerCandidate => c !== null);
  const plain = local.map((c) => plainCandidate(c, named)).filter((c): c is ServerCandidate => c !== null);

  const seen = new Set<string>();
  const unique: Omit<ServerCandidate, "id">[] = [];
  for (const candidate of [...pinned, ...plain]) {
    const key = `${candidate.url}|${candidate.pinAddress ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  return unique.map((candidate, index) => ({
    ...candidate,
    id: `${candidate.pinAddress === null ? "http" : "pinned"}-${index}`,
  }));
}

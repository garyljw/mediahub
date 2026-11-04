"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuth } from "@/server/auth";
import { AuthzError, requireRole } from "@/server/authz";
import { buildCandidates, type ServerCandidate } from "@/server/plex/candidates";
import { getPlexAdminConfig, type PlexAdminConfig } from "@/server/plex/admin-config";
import { authAppUrl, checkPin, createPin, getPlexAccount, getServerConnections } from "@/server/plex/client";
import {
  clearPlexDataConnection,
  getPlexDataClientId,
  getPlexDataConnection,
  savePlexDataConnection,
} from "@/server/plex/data-connection";
import { PlexRequestError } from "@/server/plex/errors";
import { getLibrarySections, getServerIdentity, type ServerConnection } from "@/server/plex/server";
import { parseStoredState, STATE_TTL_MS } from "@/server/plex/state";

// Plex data connection, set up from Settings -> Connections (admin only). The Plex token is used only to read from
// the Plex server. It is never sent to the browser and never used for sign-in.
//
// In-flight state lives in the verification table, keyed by the admin's user id, for 10 minutes:
//   plex-data-pin:<userId>      the PIN id, while the admin approves it on Plex
//   plex-data-pending:<userId>  the token and the candidate addresses, while the admin picks one
// Only the admin who started can finish. Replies to the browser carry only what the page needs: never the token,
// a URL or a pin address (the pick list holds the labels, and the chosen id is looked up on the server).

export type PlexFailure = { ok: false; message: string };
export type PlexStartResult = { ok: true; authUrl: string } | PlexFailure;
export type PlexCheckResult =
  | { ok: true; status: "waiting" }
  | { ok: true; status: "pick"; options: { id: string; label: string }[] }
  | PlexFailure;
export type PlexSaveResult = { ok: true; label: string; sections: number } | PlexFailure;
export type PlexTestResult = { ok: true; sections: string[] } | PlexFailure;
export type PlexDisconnectResult = { ok: true } | PlexFailure;

const DENIED = "You don't have permission to change connections.";
const FINISH_SETUP = "Finish Plex setup first.";
const NOT_CONNECTED = "Connect Plex first.";
const START_AGAIN = "Start again.";
const PLEX_UNREACHABLE = "Couldn't reach Plex. Try again.";
const TOKEN_REFUSED = "Plex refused the stored token. Connect again.";
const NOT_OWNER = "That Plex account isn't the server owner.";
const WRONG_SERVER = "That address now answers as a different Plex server. Connect again.";
const BAD_OPTION = "Choose an address from the list.";
const DATA_PRODUCT = "MediaHub watched status";
/** How long one candidate address gets to answer during the connect step. */
const ADDRESS_TIMEOUT_MS = 5_000;
const REVALIDATE_PATH = "/settings/connections";

const pinKey = (userId: string) => `plex-data-pin:${userId}`;
const pendingKey = (userId: string) => `plex-data-pending:${userId}`;

const DataPinSchema = z.object({ pinId: z.number().int() });
const PendingSchema = z.object({
  token: z.string().min(1),
  /** The server and owner the token was checked against. Save refuses if the stored setup has changed since. */
  serverId: z.string().min(1),
  ownerAccountId: z.string().min(1),
  candidates: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        url: z.string(),
        pinAddress: z.string().nullable(),
      }),
    )
    .min(1),
});
const SaveInputSchema = z.strictObject({ optionId: z.string().min(1).max(64) });

const plexDenied = (): PlexFailure => ({ ok: false, message: DENIED });

async function internalAdapter() {
  return (await getAuth().$context).internalAdapter;
}

/** The stored value for an identifier, or null when it is missing or expired. Does not consume it. */
async function readRow(identifier: string): Promise<string | null> {
  const row = await (await internalAdapter()).findVerificationValue(identifier);
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return row.value;
}

/** Deletes the row and returns its value (or null). Only the caller that gets a value may act on it. */
async function consumeRow(identifier: string): Promise<string | null> {
  const row = await (await internalAdapter()).consumeVerificationValue(identifier);
  return row?.value ?? null;
}

/** Replaces any earlier row for this identifier with a new one that lasts 10 minutes. */
async function replaceRow(identifier: string, value: unknown): Promise<void> {
  const adapter = await internalAdapter();
  await adapter.consumeVerificationValue(identifier);
  await adapter.createVerificationValue({
    identifier,
    value: JSON.stringify(value),
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
}

/** Maps a failed Plex request to a fixed message. The message is logged with no URL, token or body. */
function plexFailure(error: unknown): PlexFailure {
  if (!(error instanceof PlexRequestError)) throw error;
  console.error(error.message);
  return { ok: false, message: error.status === 401 ? TOKEN_REFUSED : PLEX_UNREACHABLE };
}

/** True when the address answers /identity with the stored server id. A failed address is simply not a match. */
async function answersAsServer(candidate: ServerCandidate, serverId: string): Promise<boolean> {
  const conn: ServerConnection = { url: candidate.url, pinAddress: candidate.pinAddress };
  try {
    return (await getServerIdentity(conn, { timeoutMs: ADDRESS_TIMEOUT_MS })) === serverId;
  } catch (error) {
    if (!(error instanceof PlexRequestError)) throw error;
    console.error(error.message);
    return false;
  }
}

/** Start: asks plex.tv for a PIN as the data device and returns the address the admin opens to approve it. */
export async function startPlexConnection(): Promise<PlexStartResult> {
  try {
    const { user } = await requireRole("admin");
    return await startFor(user.id);
  } catch (error) {
    if (error instanceof AuthzError) return plexDenied();
    throw error;
  }
}

async function startFor(userId: string): Promise<PlexStartResult> {
  if (!getPlexAdminConfig()) return { ok: false, message: FINISH_SETUP };

  const clientId = getPlexDataClientId();
  try {
    const pin = await createPin({ clientId });
    await replaceRow(pinKey(userId), { pinId: pin.id });
    return { ok: true, authUrl: authAppUrl({ code: pin.code, clientId, product: DATA_PRODUCT }) };
  } catch (error) {
    return plexFailure(error);
  }
}

/**
 * Check: one poll of the PIN. Waiting leaves the row in place. Once approved, the row is consumed and the token is
 * checked against the owner account and the stored server. Then each candidate address is tried, and the ones
 * that answer as that server are stored, server-side, for the pick step.
 */
export async function checkPlexConnection(): Promise<PlexCheckResult> {
  try {
    const { user } = await requireRole("admin");
    return await checkFor(user.id);
  } catch (error) {
    if (error instanceof AuthzError) return plexDenied();
    throw error;
  }
}

async function checkFor(userId: string): Promise<PlexCheckResult> {
  const config = getPlexAdminConfig();
  if (!config) return { ok: false, message: FINISH_SETUP };

  const stored = await readRow(pinKey(userId));
  const parsed = stored === null ? null : parseStoredState(DataPinSchema, stored);
  if (!parsed) return { ok: false, message: START_AGAIN };

  const caller = { clientId: getPlexDataClientId() };
  try {
    const token = await checkPin(parsed.pinId, caller);
    if (!token) return { ok: true, status: "waiting" };
    // Consume before the rest: a second check that also saw the approval gets nothing and must start again.
    if ((await consumeRow(pinKey(userId))) === null) return { ok: false, message: START_AGAIN };
    return await pickAddress(userId, token, config, caller);
  } catch (error) {
    return plexFailure(error);
  }
}

async function pickAddress(
  userId: string,
  token: string,
  config: PlexAdminConfig,
  caller: { clientId: string },
): Promise<PlexCheckResult> {
  const account = await getPlexAccount(token, caller);
  if (String(account.id) !== config.ownerAccountId) return { ok: false, message: NOT_OWNER };

  const connections = await getServerConnections(token, config.serverId, caller);
  if (!connections) return { ok: false, message: `Plex didn't list ${config.serverName} for that account.` };

  const candidates = buildCandidates(connections);
  const answers = await Promise.all(candidates.map((candidate) => answersAsServer(candidate, config.serverId)));
  const answering = candidates.filter((_, index) => answers[index]);
  // Plain http would send the token unencrypted, and any LAN device can claim the server's (public) identity over it.
  // So it is offered only when no pinned https address works, where the certificate proves it's the real server.
  const encrypted = answering.filter((candidate) => candidate.pinAddress !== null);
  const passing = encrypted.length > 0 ? encrypted : answering;
  if (passing.length === 0) {
    return { ok: false, message: `MediaHub couldn't reach ${config.serverName} on any of its addresses.` };
  }

  await replaceRow(pendingKey(userId), {
    token,
    serverId: config.serverId,
    ownerAccountId: config.ownerAccountId,
    candidates: passing,
  });
  return { ok: true, status: "pick", options: passing.map(({ id, label }) => ({ id, label })) };
}

/**
 * Save: the address comes from the pending row, looked up by the chosen id. The browser never supplies a URL.
 * Before saving, the address must still answer as the stored server, and the token must still list its libraries.
 */
export async function savePlexConnection(input: unknown): Promise<PlexSaveResult> {
  try {
    const { user } = await requireRole("admin");
    return await saveFor(user.id, input);
  } catch (error) {
    if (error instanceof AuthzError) return plexDenied();
    throw error;
  }
}

async function saveFor(userId: string, input: unknown): Promise<PlexSaveResult> {
  const parsed = SaveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: BAD_OPTION };
  const config = getPlexAdminConfig();
  if (!config) return { ok: false, message: FINISH_SETUP };

  // Consumed first, so the pending token can be used by one save only. A failed save means connecting again.
  const stored = await consumeRow(pendingKey(userId));
  const pending = stored === null ? null : parseStoredState(PendingSchema, stored);
  if (!pending) return { ok: false, message: START_AGAIN };
  if (pending.serverId !== config.serverId || pending.ownerAccountId !== config.ownerAccountId) {
    return { ok: false, message: START_AGAIN };
  }
  const option = pending.candidates.find((candidate) => candidate.id === parsed.data.optionId);
  if (!option) return { ok: false, message: BAD_OPTION };

  const conn: ServerConnection = { url: option.url, pinAddress: option.pinAddress };
  try {
    if ((await getServerIdentity(conn)) !== config.serverId) return { ok: false, message: WRONG_SERVER };
    const sections = await getLibrarySections(conn, pending.token);
    savePlexDataConnection({ url: option.url, pinAddress: option.pinAddress, token: pending.token });
    revalidatePath(REVALIDATE_PATH);
    return { ok: true, label: option.label, sections: sections.length };
  } catch (error) {
    return plexFailure(error);
  }
}

/** Test: the stored address must still answer as the stored server, then its libraries are listed. */
export async function testPlexConnection(): Promise<PlexTestResult> {
  try {
    await requireRole("admin");
    return await testFor();
  } catch (error) {
    if (error instanceof AuthzError) return plexDenied();
    throw error;
  }
}

async function testFor(): Promise<PlexTestResult> {
  const config = getPlexAdminConfig();
  if (!config) return { ok: false, message: FINISH_SETUP };
  const stored = getPlexDataConnection();
  if (!stored) return { ok: false, message: NOT_CONNECTED };

  const conn: ServerConnection = { url: stored.url, pinAddress: stored.pinAddress };
  try {
    if ((await getServerIdentity(conn)) !== config.serverId) return { ok: false, message: WRONG_SERVER };
    const sections = await getLibrarySections(conn, stored.token);
    return { ok: true, sections: sections.map((section) => section.title) };
  } catch (error) {
    return plexFailure(error);
  }
}

/** Disconnect: removes the stored address, pin and token. The data client id is kept. */
export async function disconnectPlex(): Promise<PlexDisconnectResult> {
  try {
    await requireRole("admin");
    return await disconnectFor();
  } catch (error) {
    if (error instanceof AuthzError) return plexDenied();
    throw error;
  }
}

async function disconnectFor(): Promise<PlexDisconnectResult> {
  clearPlexDataConnection();
  revalidatePath(REVALIDATE_PATH);
  return { ok: true };
}

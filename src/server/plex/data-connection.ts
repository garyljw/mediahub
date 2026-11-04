import "server-only";
import { randomUUID } from "node:crypto";
import { eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/server/db";
import { setting, verification } from "@/server/db/schema";

// The Plex data connection: the server address and the legacy Plex token MediaHub uses to READ data from the
// Plex server. It is never used for sign-in. Set by an admin in Settings -> Connections, stored in the setting
// table, and never sent to the browser (the token is write-only, like the Arr keys).

const CLIENT_ID_KEY = "plex.dataClientId";
const TOKEN_KEY = "plex.dataToken";
const URL_KEY = "plex.dataUrl";
const PIN_ADDRESS_KEY = "plex.dataPinAddress";
const CONNECTION_KEYS = [TOKEN_KEY, URL_KEY, PIN_ADDRESS_KEY];

export type PlexDataConnection = {
  url: string;
  /** The IP to pin the lookup to, for an https plex.direct address. Null for plain http. */
  pinAddress: string | null;
  token: string;
};

let cachedClientId: string | undefined;

function storedClientId(): string | undefined {
  return db().select().from(setting).where(eq(setting.key, CLIENT_ID_KEY)).get()?.value;
}

/** The client id every data-connection call is made as. Generated once, not a secret, reused for every call. */
export function getPlexDataClientId(): string {
  if (cachedClientId) return cachedClientId;

  const existing = storedClientId();
  if (existing) {
    cachedClientId = existing;
    return existing;
  }

  // onConflictDoNothing: if another request stored one first, its value wins and is read back below.
  db()
    .insert(setting)
    .values({ key: CLIENT_ID_KEY, value: `mediahub-data-${randomUUID()}`, updatedAt: new Date() })
    .onConflictDoNothing()
    .run();

  const stored = storedClientId();
  if (!stored) throw new Error("The Plex data client id could not be stored or read back.");
  cachedClientId = stored;
  return stored;
}

/** Forgets the in-memory copy so the next call reads the setting table again. For tests only. */
export function resetPlexDataClientIdCache(): void {
  cachedClientId = undefined;
}

function readValues(): Map<string, string> {
  const rows = db().select().from(setting).where(inArray(setting.key, CONNECTION_KEYS)).all();
  return new Map(rows.map((row) => [row.key, row.value]));
}

/** The stored connection, or null unless both the address and the token are stored. Server-only callers. */
export function getPlexDataConnection(): PlexDataConnection | null {
  const values = readValues();
  const url = values.get(URL_KEY);
  const token = values.get(TOKEN_KEY);
  if (!url || !token) return null;
  return { url, pinAddress: values.get(PIN_ADDRESS_KEY) ?? null, token };
}

/**
 * What the Connections page may show. Never the token, only whether the connection is complete and the address.
 */
export function getPlexDataSummary(): { connected: boolean; url: string | null } {
  const values = readValues();
  const url = values.get(URL_KEY) ?? null;
  const connected = Boolean(url && values.get(TOKEN_KEY));
  return { connected, url: connected ? url : null };
}

/** Stores the connection in one transaction. The pin address row is removed when there is no pin address. */
export function savePlexDataConnection({ url, pinAddress, token }: PlexDataConnection): void {
  const updatedAt = new Date();
  db().transaction((tx) => {
    for (const [key, value] of [
      [URL_KEY, url],
      [TOKEN_KEY, token],
    ] as const) {
      tx.insert(setting)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({ target: setting.key, set: { value, updatedAt } })
        .run();
    }
    if (pinAddress === null) {
      tx.delete(setting).where(eq(setting.key, PIN_ADDRESS_KEY)).run();
    } else {
      tx.insert(setting)
        .values({ key: PIN_ADDRESS_KEY, value: pinAddress, updatedAt })
        .onConflictDoUpdate({ target: setting.key, set: { value: pinAddress, updatedAt } })
        .run();
    }
  });
}

/** Removes the address, pin and token. The data client id is kept: it is not secret and is reused. */
export function clearPlexDataConnection(): void {
  db().transaction((tx) => {
    tx.delete(setting).where(inArray(setting.key, CONNECTION_KEYS)).run();
    // In-flight connect steps too (see plex-actions.ts): a pending row holds a token checked against the old setup.
    tx.delete(verification)
      .where(or(like(verification.identifier, "plex-data-pin:%"), like(verification.identifier, "plex-data-pending:%")))
      .run();
  });
}

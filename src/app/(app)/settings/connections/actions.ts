"use server";

import { revalidatePath } from "next/cache";
import { AuthzError, requireRole } from "@/server/authz";
import { createRadarrClient, createSonarrClient, resetArrClients } from "@/server/arr/client";
import { ArrRequestError, arrRequest } from "@/server/arr/request";
import {
  APP_NAMES,
  parseConnectionInput,
  resolveApiKey,
  type Failure,
  type ParsedConnectionInput,
} from "@/server/settings/connection-input";
import { getConnection, saveConnection, type ArrApp, type Connection } from "@/server/settings/connections";

export type ConnectionResult = { ok: true; appName: "Radarr" | "Sonarr"; version: string } | Failure;

// The generated schema allows null for these fields, so both are checked before use.
type StatusReply = { version?: string | null; appName?: string | null };

// Asks the app for its status with a one-off client built from the given connection. The cached client is not used,
// so a test never changes what the rest of the app talks to. The check is on the reply's shape only: appName is not
// compared, because its exact value has not been verified against a live instance.
async function checkConnection(app: ArrApp, connection: Connection): Promise<ConnectionResult> {
  const name = APP_NAMES[app];
  try {
    const reply = await arrRequest<StatusReply>(`${name} connection test`, (signal) =>
      app === "radarr"
        ? createRadarrClient(connection).GET("/api/v3/system/status", { signal })
        : createSonarrClient(connection).GET("/api/v3/system/status", { signal }),
    );
    if (!reply?.version || !reply.appName) {
      throw new ArrRequestError(`${name} connection test response was not a status`, "invalid");
    }
    return { ok: true, appName: name, version: reply.version };
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // The message holds only the label, kind or status: never the host or the key.
    console.error(error.message);
    return { ok: false, message: failureText(name, error) };
  }
}

function failureText(name: "Radarr" | "Sonarr", error: ArrRequestError): string {
  switch (error.kind) {
    case "timeout":
      return "Timed out.";
    case "network":
      return "Couldn't reach it. Check the address.";
    case "invalid":
      return `That doesn't look like ${name}.`;
    case "http":
      return error.status === 401 ? "The API key was refused." : `It answered with HTTP ${error.status ?? "an error"}.`;
    default:
      return `Couldn't test the connection to ${name}.`;
  }
}

/** Parses the input and picks the key, which may come from the stored connection (see resolveApiKey). */
async function prepare(input: unknown): Promise<({ ok: true; target: ParsedConnectionInput & { apiKey: string } }) | Failure> {
  const parsed = parseConnectionInput(input);
  if (!parsed.ok) return parsed;
  const { app, url, apiKey } = parsed.value;
  // Read here, on the server. The stored key is used below and never returned.
  const key = resolveApiKey({ apiKey, url, stored: getConnection(app) });
  if (!key.ok) return key;
  return { ok: true, target: { app, url, apiKey: key.apiKey } };
}

const DENIED = "You don't have permission to change connections.";

/** Tests a connection without saving it (admin only). The role check runs first, inside try. */
export async function testConnection(input: unknown): Promise<ConnectionResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const prepared = await prepare(input);
  if (!prepared.ok) return prepared;
  const { app, url, apiKey } = prepared.target;
  return checkConnection(app, { url, apiKey });
}

/**
 * Tests the connection and, only if the test passes, saves it (admin only). Saving drops the cached Arr clients and
 * refreshes the layout so the new connection is used straight away. The role check runs first, inside try.
 */
export async function saveConnectionSettings(input: unknown): Promise<ConnectionResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const prepared = await prepare(input);
  if (!prepared.ok) return prepared;
  const { app, url, apiKey } = prepared.target;
  const result = await checkConnection(app, { url, apiKey });
  if (!result.ok) return result;

  saveConnection(app, { url, apiKey });
  resetArrClients();
  revalidatePath("/", "layout");
  return result;
}

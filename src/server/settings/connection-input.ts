import "server-only";
import { z } from "zod";
import type { ArrApp, Connection } from "./connections";

// Pure input rules for the Connections settings. The actions in
// src/app/(app)/settings/connections/actions.ts call these before they touch Radarr or Sonarr.

export const APP_NAMES: Record<ArrApp, "Radarr" | "Sonarr"> = { radarr: "Radarr", sonarr: "Sonarr" };

const MAX_URL_LENGTH = 2048;
const API_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export type Failure = { ok: false; message: string };

const fail = (message: string): Failure => ({ ok: false, message });

export const INVALID_INPUT = "Check the address and API key.";

// Empty key means "not given". strictObject rejects any other field.
const ConnectionFields = z.strictObject({
  app: z.enum(["radarr", "sonarr"]),
  url: z.string().trim().min(1).max(MAX_URL_LENGTH),
  apiKey: z
    .string()
    .trim()
    .transform((key) => (key === "" ? undefined : key))
    .pipe(z.string().min(20).max(128).regex(API_KEY_PATTERN).optional())
    .optional(),
});

/**
 * Turns a typed address into the stored form: origin plus path, with trailing slashes removed, so a
 * base path such as http://host:7878/radarr is kept. Credentials, queries and fragments are refused.
 */
export function normalizeArrUrl(raw: string): { ok: true; url: string } | Failure {
  if (raw.includes("?") || raw.includes("#")) return fail("Leave out the ? and # part of the address.");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail("Enter a full address, such as http://192.168.1.10:7878.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail("The address must start with http:// or https://.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return fail("Leave the username and password out of the address.");
  }
  if (parsed.search !== "" || parsed.hash !== "") return fail("Leave out the ? and # part of the address.");
  return { ok: true, url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}` };
}

export type ParsedConnectionInput = { app: ArrApp; url: string; apiKey: string | undefined };

/** Validates the shape of an action's input, then normalises the address. */
export function parseConnectionInput(input: unknown): { ok: true; value: ParsedConnectionInput } | Failure {
  const parsed = ConnectionFields.safeParse(input);
  if (!parsed.success) return fail(INVALID_INPUT);
  const url = normalizeArrUrl(parsed.data.url);
  if (!url.ok) return url;
  return { ok: true, value: { app: parsed.data.app, url: url.url, apiKey: parsed.data.apiKey } };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Picks the key to test and save. A typed key always wins. Without one, the stored key is reused only when
 * the stored connection exists and the new address has the same origin (scheme, host and port). That stops a
 * session that was hijacked from pointing the stored key at another host.
 */
export function resolveApiKey({
  apiKey,
  url,
  stored,
}: {
  apiKey: string | undefined;
  url: string;
  stored: Connection | null;
}): { ok: true; apiKey: string } | Failure {
  if (apiKey !== undefined) return { ok: true, apiKey };
  if (!stored) return fail("Enter the API key.");
  if (sameOrigin(stored.url, url)) return { ok: true, apiKey: stored.apiKey };
  return fail("Enter the API key again. It's needed when the address changes.");
}

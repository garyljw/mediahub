import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";

// Shared pieces of the Plex sign-in state. Each in-flight step has a random value in a browser
// cookie, and the matching server-side record lives in the verification table under the identifier
// built from that value. Only the browser that started a step holds the cookie, so only it can
// finish the step.

export const PIN_COOKIE = "mediahub_plex_pin";
export const SETUP_COOKIE = "mediahub_plex_setup";
export const STATE_TTL_MS = 10 * 60 * 1000;
export const STATE_COOKIE_MAX_AGE_SECONDS = 600;

export const pinIdentifier = (state: string) => `plex-pin:${state}`;
export const setupIdentifier = (state: string) => `plex-setup:${state}`;

export function newStateValue(): string {
  return randomBytes(32).toString("base64url");
}

// The PIN row holds the Plex PIN id for the 10-minute window between start and callback. It holds no
// key and no token. The callback consumes (deletes) the row before it checks the PIN.
export const PinStateSchema = z.object({
  pinId: z.number().int(),
});

export const SetupServerSchema = z.object({
  clientIdentifier: z.string().min(1),
  name: z.string().min(1),
});

export const SetupStateSchema = z.object({
  accountId: z.string().min(1),
  username: z.string(),
  email: z.string().nullable(),
  servers: z.array(SetupServerSchema).min(1),
});

export type SetupState = z.infer<typeof SetupStateSchema>;

/** Parses a stored verification value. Anything that doesn't match the schema counts as missing. */
export function parseStoredState<T>(schema: z.ZodType<T>, raw: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

import "server-only";
import { getAuth } from "@/server/auth";
import { parseStoredState, setupIdentifier, SetupStateSchema, type SetupState } from "./state";

/**
 * The pending setup behind the browser's setup cookie, read without consuming it. Used by the
 * /setup/server page to list the servers. The POST that finishes setup consumes it.
 */
export async function readPendingSetup(state: string | undefined): Promise<SetupState | null> {
  if (!state) return null;
  const internal = (await getAuth().$context).internalAdapter;
  const row = await internal.findVerificationValue(setupIdentifier(state));
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return parseStoredState(SetupStateSchema, row.value);
}

"use server";

import { revalidatePath } from "next/cache";
import { AuthzError, requireRole } from "@/server/authz";
import { requestUpdateCheck } from "@/server/updater/app-view";

export type CheckResult = { ok: true; queued: boolean } | { ok: false; message: string };

const DENIED = "You don't have permission to check for updates.";
const UNAVAILABLE = "Updates are only available when MediaHub is installed with the Windows installer.";
const FAILED = "Couldn't ask the updater to check.";

/**
 * Asks the updater for a check now (admin only). The role check runs first, inside try. Nothing from the browser is
 * used. Only the error code is logged, never a path.
 */
export async function checkForUpdatesNow(): Promise<CheckResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  let outcome: ReturnType<typeof requestUpdateCheck>;
  try {
    outcome = requestUpdateCheck();
  } catch (error) {
    console.error(`Update check request failed (${errorCode(error)}).`);
    return { ok: false, message: FAILED };
  }
  if (outcome === "unavailable") return { ok: false, message: UNAVAILABLE };

  revalidatePath("/settings/updates");
  return { ok: true, queued: true };
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "unknown";
}

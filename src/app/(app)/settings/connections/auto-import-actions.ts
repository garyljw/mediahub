"use server";

import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { saveAutoImportMatchedById } from "@/server/settings/auto-import";

export type AutoImportResult = { ok: true } | { ok: false; message: string };

const DENIED = "You don't have permission to change this setting.";

// strictObject rejects unknown keys. Only the switch's value crosses from the browser.
const AutoImportInput = z.strictObject({ on: z.boolean() });

const INVALID = "Choose on or off.";

/** Saves the "Auto-import downloads matched by ID" switch (admin only). The role check runs first, inside try. */
export async function saveAutoImportSetting(input: unknown): Promise<AutoImportResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const parsed = AutoImportInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID };

  saveAutoImportMatchedById(parsed.data.on);
  return { ok: true };
}

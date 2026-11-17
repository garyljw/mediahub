"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { savePhoneBackButton } from "@/server/settings/phone-back-button";

export type PhoneBackButtonResult = { ok: true } | { ok: false; message: string };

const DENIED = "You don't have permission to change this setting.";

// strictObject rejects unknown keys. Only the switch's value crosses from the browser.
const PhoneBackButtonInput = z.strictObject({ on: z.boolean() });

const INVALID = "Choose on or off.";

/** Saves the "Back button on phones" switch (admin only). The role check runs first, inside try. */
export async function savePhoneBackButtonSetting(input: unknown): Promise<PhoneBackButtonResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const parsed = PhoneBackButtonInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID };

  savePhoneBackButton(parsed.data.on);
  // The tab bar lives in the layout, which doesn't re-render on its own after an action. Refresh so the button
  // shows or hides at once.
  refresh();
  return { ok: true };
}

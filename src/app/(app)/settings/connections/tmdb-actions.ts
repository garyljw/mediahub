"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { fetchRegions, TmdbRequestError, validateToken } from "@/server/tmdb/client";
import { tmdbFailureText } from "@/server/tmdb/errors";
import { TMDB_LANGUAGE_CODES } from "@/components/settings/tmdb-languages";
import { getTmdbConfig, removeTmdbConfig, saveTmdbConfig } from "@/server/settings/tmdb";

// Optional TMDB connection (Settings -> Connections, admin only). The token is write-only: it is checked with TMDB
// before it is stored and never sent back to the browser.

export type TmdbResult = { ok: true } | { ok: false; message: string };

const DENIED = "You don't have permission to change connections.";
const INVALID = "Check the token and country and try again.";
const UNKNOWN_REGION = "Pick a country from the list.";
const NO_TOKEN = "Paste the Read Access Token.";
const REVALIDATE_PATH = "/settings/connections";

// TMDB's Read Access Token is a long JWT (a few hundred characters). Blank means "keep the stored token".
const SaveInputSchema = z.strictObject({
  token: z.string().trim().max(2000),
  region: z.string().regex(/^[A-Z]{2}$/),
  language: z.enum(TMDB_LANGUAGE_CODES),
});

/** Saves the token (checked with TMDB first) and country. A blank token keeps the stored one. */
export async function saveTmdbSettings(input: unknown): Promise<TmdbResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const parsed = SaveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID };
  const { region, language } = parsed.data;

  let token = parsed.data.token;
  if (token === "") {
    const stored = getTmdbConfig();
    if (!stored) return { ok: false, message: NO_TOKEN };
    token = stored.token;
  } else {
    try {
      await validateToken(token);
    } catch (error) {
      if (!(error instanceof TmdbRequestError)) throw error;
      // The message holds only the step, kind or status: never the host or the token.
      console.error(error.message);
      return { ok: false, message: tmdbFailureText(error) };
    }
  }

  // The country must be one TMDB lists, checked with the token that will be saved.
  try {
    const regions = await fetchRegions(token);
    if (!regions.some((r) => r.code === region)) return { ok: false, message: UNKNOWN_REGION };
  } catch (error) {
    if (!(error instanceof TmdbRequestError)) throw error;
    console.error(error.message);
    return { ok: false, message: tmdbFailureText(error) };
  }

  saveTmdbConfig({ token, region, language });
  revalidatePath(REVALIDATE_PATH);
  revalidatePath("/popular");
  return { ok: true };
}

/** Removes the stored token and country. */
export async function removeTmdbSettings(): Promise<TmdbResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  removeTmdbConfig();
  revalidatePath(REVALIDATE_PATH);
  revalidatePath("/popular");
  return { ok: true };
}

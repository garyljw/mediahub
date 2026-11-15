"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import { mergeServices } from "@/server/merge/popular";
import { getTmdbConfig, saveChosenServices } from "@/server/settings/tmdb";
import { getProviders, TmdbRequestError } from "@/server/tmdb/client";
import { tmdbFailureText } from "@/server/tmdb/errors";

// Which streaming services the Popular page offers, and their order (Settings -> Popular, admin only).

export type PopularServicesResult = { ok: true } | { ok: false; message: string };

const DENIED = "You don't have permission to change Popular settings.";
const INVALID = "Pick services from the list.";
const NO_TOKEN = "Add a TMDB token in Settings → Connections first.";
const UNKNOWN = "That service isn't offered in your country any more. Reload and try again.";

const InputSchema = z
  .strictObject({ ids: z.array(z.number().int().positive()).max(50) })
  .refine((value) => new Set(value.ids).size === value.ids.length);

/** Saves the chosen services in order. Empty means TMDB's top 12. Every id must be offered for movies or TV in the stored country. */
export async function savePopularServices(input: unknown): Promise<PopularServicesResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, message: DENIED };
    throw error;
  }

  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID };
  const { ids } = parsed.data;

  const config = getTmdbConfig();
  if (!config) return { ok: false, message: NO_TOKEN };

  if (ids.length > 0) {
    try {
      const [movie, tv] = await Promise.all([
        getProviders(config.token, "movie", config.region),
        getProviders(config.token, "tv", config.region),
      ]);
      const offered = new Set(mergeServices(movie, tv, config.region).map((p) => p.id));
      if (!ids.every((id) => offered.has(id))) return { ok: false, message: UNKNOWN };
    } catch (error) {
      if (!(error instanceof TmdbRequestError)) throw error;
      // The message holds only the step, kind or status: never the host or the token.
      console.error(error.message);
      return { ok: false, message: tmdbFailureText(error) };
    }
  }

  saveChosenServices(ids);
  revalidatePath("/settings/popular");
  revalidatePath("/popular");
  return { ok: true };
}

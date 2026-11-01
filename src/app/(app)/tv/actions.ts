"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthzError, requireRole } from "@/server/authz";
import {
  deleteSeries,
  editSeries,
  listSeriesQualityProfiles,
  type SeriesEdit,
} from "@/server/arr/series";
import { ArrRequestError } from "@/server/arr/request";
import { MAX_EDIT_SERIES } from "@/components/tv/series-edit";

export type EditResult = { ok: true } | { ok: false; error: string };

// strictObject rejects unknown keys. The refine requires at least one change, so an empty edit is refused.
const SeriesEditInput = z
  .strictObject({
    seriesIds: z.array(z.number().int().positive()).min(1).max(MAX_EDIT_SERIES),
    qualityProfileId: z.number().int().positive().optional(),
    monitored: z.boolean().optional(),
  })
  .refine((input) => input.qualityProfileId !== undefined || input.monitored !== undefined);

/**
 * Bulk edit of Sonarr series (admin only). The role check is the first thing that runs. It sits
 * inside try so a denial returns { ok: false } instead of throwing. The catch always returns or
 * throws, so nothing after it runs without a passed check. src/app/server-actions-auth.test.ts
 * enforces this shape for every action.
 */
export async function updateSeries(input: unknown): Promise<EditResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to edit series." };
    throw error;
  }

  const parsed = SeriesEditInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid edit." };

  const { qualityProfileId, monitored } = parsed.data;
  // A Set drops duplicate ids, so Sonarr gets each series once.
  const edit: SeriesEdit = { seriesIds: [...new Set(parsed.data.seriesIds)] };
  if (qualityProfileId !== undefined) edit.qualityProfileId = qualityProfileId;
  if (monitored !== undefined) edit.monitored = monitored;

  try {
    if (qualityProfileId !== undefined) {
      const profiles = await listSeriesQualityProfiles();
      if (!profiles.some((profile) => profile.id === qualityProfileId)) {
        return { ok: false, error: "That quality profile no longer exists." };
      }
    }
    await editSeries(edit);
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Series edit: ${error.message}`);
    return { ok: false, error: "Sonarr didn't accept the change. Try again." };
  }

  // The TV page reads Sonarr on every request and nothing is cached, so there is no cache entry
  // to invalidate. refresh() re-renders the current route, so the table shows the new values.
  refresh();
  return { ok: true };
}

export type DeleteResult = { ok: true; deleted: number } | { ok: false; error: string };

// strictObject rejects unknown keys (e.g. a stray moveFiles). deleteFiles and addImportListExclusion are
// required, so a missing choice can never be read as "no". confirmCount must equal the de-duplicated id
// count: a sanity check that catches a UI bug sending more or fewer series than the dialog showed. It
// compares counts only, not which series; that's fine because only an admin can get this far.
const SeriesDeleteInput = z.strictObject({
  seriesIds: z.array(z.number().int().positive()).min(1).max(MAX_EDIT_SERIES),
  deleteFiles: z.boolean(),
  addImportListExclusion: z.boolean(),
  confirmCount: z.number().int().positive(),
});

/**
 * Bulk delete of Sonarr series (admin only). Same shape as updateSeries: the role check runs first,
 * inside try, and the catch always returns or throws. src/app/server-actions-auth.test.ts enforces this.
 */
export async function removeSeries(input: unknown): Promise<DeleteResult> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof AuthzError) return { ok: false, error: "You don't have permission to delete series." };
    throw error;
  }

  const parsed = SeriesDeleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid delete." };

  const { deleteFiles, addImportListExclusion, confirmCount } = parsed.data;
  // A Set drops duplicate ids, so Sonarr gets each series once. The count check runs on the unique ids.
  const seriesIds = [...new Set(parsed.data.seriesIds)];
  if (confirmCount !== seriesIds.length) return { ok: false, error: "Invalid delete." };

  try {
    await deleteSeries({ seriesIds, deleteFiles, addImportListExclusion });
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`Series delete: ${error.message}`);
    // Sonarr may have deleted some or all of them anyway (certainly possible after a timeout), so
    // re-read the table rather than keep showing rows that might be gone.
    refresh();
    if (error.kind === "timeout") {
      return { ok: false, error: "Sonarr is taking a long time and may still be deleting. The table has been refreshed; check it before trying again." };
    }
    // Any failure after the request was sent (a proxy 504, a dropped connection, an odd reply) is
    // ambiguous too, so don't claim nothing was deleted.
    return { ok: false, error: "Sonarr didn't confirm the delete, so some series may already be gone. The table has been refreshed; check it before trying again." };
  }

  // Nothing is cached, so refresh() is enough for the table to drop the deleted rows.
  refresh();
  return { ok: true, deleted: seriesIds.length };
}

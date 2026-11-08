import "server-only";
import { and, asc, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { replaceGrab } from "@/server/db/schema";

// The grabs an admin made with "Replace existing file" ticked. The only code that touches the replace_grab table.
// The worker that imports them is in ./auto-import.ts.

export type ReplaceApp = "radarr" | "sonarr";

export type PendingReplaceGrab = {
  id: number;
  app: ReplaceApp;
  guid: string;
  downloadId: string | null;
  createdAt: number;
};

/** A remembered grab is dropped after this long, so a grab that never reaches the queue doesn't stay forever. */
export const REPLACE_GRAB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Remembers a grab the app accepted. `now` is injected so tests can set the clock. */
export function recordReplaceGrab(app: ReplaceApp, guid: string, now = Date.now()): void {
  db().insert(replaceGrab).values({ app, guid, downloadId: null, createdAt: now }).run();
}

/**
 * Deletes rows older than REPLACE_GRAB_TTL_MS, then returns the rest, oldest first. Rows with no download id yet are
 * included, so the worker can look one up.
 */
export function pendingReplaceGrabs(now = Date.now()): PendingReplaceGrab[] {
  db().delete(replaceGrab).where(lt(replaceGrab.createdAt, now - REPLACE_GRAB_TTL_MS)).run();
  return db().select().from(replaceGrab).orderBy(asc(replaceGrab.id)).all();
}

/** Stores the download id the app's history gave for a remembered grab. */
export function setReplaceDownloadId(id: number, downloadId: string): void {
  db().update(replaceGrab).set({ downloadId }).where(eq(replaceGrab.id, id)).run();
}

/** Forgets a remembered grab, once it has been imported, has left the queue, or was never found in the queue. */
export function deleteReplaceGrab(id: number): void {
  db().delete(replaceGrab).where(eq(replaceGrab.id, id)).run();
}

/** The download ids of this app's remembered grabs that have one, for the Queue's "Will replace existing file" label. */
export function replacingDownloadIds(app: ReplaceApp): Set<string> {
  const rows = db()
    .select({ downloadId: replaceGrab.downloadId })
    .from(replaceGrab)
    .where(and(eq(replaceGrab.app, app), isNotNull(replaceGrab.downloadId)))
    .all();
  return new Set(rows.map((row) => row.downloadId).filter((id): id is string => id !== null));
}

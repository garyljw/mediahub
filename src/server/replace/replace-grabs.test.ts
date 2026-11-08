import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";

// Each test gets a fresh in-memory database with the real migrations applied.
const testDb = vi.hoisted(() => ({ current: undefined as ReturnType<typeof drizzle<typeof schema>> | undefined }));

vi.mock("@/server/db", () => ({ db: () => testDb.current }));

import {
  REPLACE_GRAB_TTL_MS,
  deleteReplaceGrab,
  pendingReplaceGrabs,
  recordReplaceGrab,
  replacingDownloadIds,
  setReplaceDownloadId,
} from "./replace-grabs";

const NOW = 1_800_000_000_000;

beforeEach(() => {
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  testDb.current = instance;
});

describe("replace grabs", () => {
  it("returns a remembered grab with no download id yet, oldest first", () => {
    recordReplaceGrab("sonarr", "guid-b", NOW);
    recordReplaceGrab("radarr", "guid-a", NOW + 1);
    expect(pendingReplaceGrabs(NOW + 2)).toEqual([
      { id: 1, app: "sonarr", guid: "guid-b", downloadId: null, createdAt: NOW },
      { id: 2, app: "radarr", guid: "guid-a", downloadId: null, createdAt: NOW + 1 },
    ]);
  });

  it("drops a grab older than the 7-day lifetime, and does not return it", () => {
    recordReplaceGrab("radarr", "old", NOW);
    recordReplaceGrab("radarr", "fresh", NOW + REPLACE_GRAB_TTL_MS - 1);
    const later = NOW + REPLACE_GRAB_TTL_MS + 1;
    expect(pendingReplaceGrabs(later).map((row) => row.guid)).toEqual(["fresh"]);
    // The old row was deleted, not just hidden: even an earlier clock doesn't bring it back.
    expect(pendingReplaceGrabs(NOW).map((row) => row.guid)).toEqual(["fresh"]);
  });

  it("stores the download id that the worker resolved", () => {
    recordReplaceGrab("radarr", "guid-a", NOW);
    setReplaceDownloadId(1, "DL-1");
    expect(pendingReplaceGrabs(NOW)[0].downloadId).toBe("DL-1");
  });

  it("forgets a grab when it is deleted", () => {
    recordReplaceGrab("radarr", "guid-a", NOW);
    recordReplaceGrab("radarr", "guid-b", NOW);
    deleteReplaceGrab(1);
    expect(pendingReplaceGrabs(NOW).map((row) => row.guid)).toEqual(["guid-b"]);
  });

  it("lists only the download ids of one app's grabs that have one", () => {
    recordReplaceGrab("radarr", "guid-a", NOW);
    recordReplaceGrab("radarr", "guid-b", NOW);
    recordReplaceGrab("sonarr", "guid-c", NOW);
    setReplaceDownloadId(1, "DL-RADARR");
    setReplaceDownloadId(3, "DL-SONARR");
    expect(replacingDownloadIds("radarr")).toEqual(new Set(["DL-RADARR"]));
    expect(replacingDownloadIds("sonarr")).toEqual(new Set(["DL-SONARR"]));
  });
});

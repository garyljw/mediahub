import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArrRequestError } from "@/server/arr/request";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  editSeries: vi.fn(),
  deleteSeries: vi.fn(),
  listSeriesQualityProfiles: vi.fn(),
  refresh: vi.fn(),
}));

// AuthzError must be a real class: the action checks `instanceof AuthzError`.
vi.mock("@/server/authz", () => {
  class AuthzError extends Error {
    constructor(readonly status: 401 | 403) {
      super(status === 401 ? "unauthorized" : "forbidden");
      this.name = "AuthzError";
    }
  }
  return { AuthzError, requireRole: mocks.requireRole };
});

vi.mock("@/server/arr/series", () => ({
  editSeries: mocks.editSeries,
  deleteSeries: mocks.deleteSeries,
  listSeriesQualityProfiles: mocks.listSeriesQualityProfiles,
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import { AuthzError } from "@/server/authz";
import { removeSeries, updateSeries } from "./actions";
import { MAX_EDIT_SERIES } from "@/components/tv/series-edit";

const DENIED = "You don't have permission to edit series.";
const DELETE_DENIED = "You don't have permission to delete series.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "u1", email: "a@example.test", name: "A", role: "admin" } });
  mocks.editSeries.mockResolvedValue(undefined);
  mocks.deleteSeries.mockResolvedValue(undefined);
  mocks.listSeriesQualityProfiles.mockResolvedValue([
    { id: 1, name: "HD-1080p" },
    { id: 2, name: "Any" },
  ]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("updateSeries authorization", () => {
  it("checks for the admin role", async () => {
    await updateSeries({ seriesIds: [1], monitored: true });
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    const result = await updateSeries({ seriesIds: [1], monitored: true });

    expect(result).toEqual({ ok: false, error: DENIED });
    expect(mocks.editSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    const result = await updateSeries({ seriesIds: [1], monitored: true });

    expect(result).toEqual({ ok: false, error: DENIED });
    expect(mocks.editSeries).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(updateSeries({ seriesIds: [1], monitored: true })).rejects.toThrow("database down");
    expect(mocks.editSeries).not.toHaveBeenCalled();
  });
});

describe("updateSeries input validation", () => {
  const invalid: [string, unknown][] = [
    ["not an object", "series"],
    ["null", null],
    ["empty seriesIds", { seriesIds: [], monitored: true }],
    ["a negative id", { seriesIds: [-1], monitored: true }],
    ["a zero id", { seriesIds: [0], monitored: true }],
    ["a string id", { seriesIds: ["1"], monitored: true }],
    ["a fractional id", { seriesIds: [1.5], monitored: true }],
    ["an unknown key", { seriesIds: [1], monitored: true, deleteFiles: true }],
    ["a movieIds key", { movieIds: [1], monitored: true }],
    ["no change fields", { seriesIds: [1] }],
    ["a string profile id", { seriesIds: [1], qualityProfileId: "2" }],
    ["a non-boolean monitored", { seriesIds: [1], monitored: "yes" }],
    ["more than 2000 ids", { seriesIds: Array.from({ length: 2001 }, (_, i) => i + 1), monitored: true }],
  ];

  it.each(invalid)("rejects %s without calling Sonarr", async (_name, input) => {
    const result = await updateSeries(input);

    expect(result).toEqual({ ok: false, error: "Invalid edit." });
    expect(mocks.editSeries).not.toHaveBeenCalled();
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("uses the same 2000 limit as the client", () => {
    expect(MAX_EDIT_SERIES).toBe(2000);
  });

  it("accepts exactly 2000 ids", async () => {
    const seriesIds = Array.from({ length: 2000 }, (_, i) => i + 1);
    const result = await updateSeries({ seriesIds, monitored: true });
    expect(result).toEqual({ ok: true });
    expect(mocks.editSeries).toHaveBeenCalledWith({ seriesIds, monitored: true });
  });

  it("does not put Zod details in the error", async () => {
    const result = await updateSeries({ seriesIds: [-1], monitored: true });
    expect(JSON.stringify(result)).not.toMatch(/Too small|received|issues|path/);
  });
});

describe("updateSeries edits", () => {
  it("de-duplicates ids before calling Sonarr", async () => {
    await updateSeries({ seriesIds: [3, 1, 3, 2, 1], monitored: false });
    expect(mocks.editSeries).toHaveBeenCalledWith({ seriesIds: [3, 1, 2], monitored: false });
  });

  it("checks that a chosen quality profile still exists", async () => {
    const result = await updateSeries({ seriesIds: [1], qualityProfileId: 99 });

    expect(result).toEqual({ ok: false, error: "That quality profile no longer exists." });
    expect(mocks.editSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not check the profile list when no profile is chosen", async () => {
    await updateSeries({ seriesIds: [1], monitored: true });
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
  });

  it("gives the friendly error when Sonarr rejects the edit, and logs only the safe message", async () => {
    mocks.editSeries.mockRejectedValue(new ArrRequestError("Sonarr series edit request failed: HTTP 500"));

    const result = await updateSeries({ seriesIds: [1], monitored: true });

    expect(result).toEqual({ ok: false, error: "Sonarr didn't accept the change. Try again." });
    expect(console.error).toHaveBeenCalledWith("Series edit: Sonarr series edit request failed: HTTP 500");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("gives the friendly error when the profile list cannot be fetched", async () => {
    mocks.listSeriesQualityProfiles.mockRejectedValue(new ArrRequestError("Sonarr quality profile request failed: timed out", "timeout"));

    const result = await updateSeries({ seriesIds: [1], qualityProfileId: 1 });

    expect(result).toEqual({ ok: false, error: "Sonarr didn't accept the change. Try again." });
    expect(mocks.editSeries).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.editSeries.mockRejectedValue(new Error("config broken"));
    await expect(updateSeries({ seriesIds: [1], monitored: true })).rejects.toThrow("config broken");
  });

  it("on success calls editSeries with exactly the validated fields, then refreshes", async () => {
    const result = await updateSeries({ seriesIds: [5, 6], qualityProfileId: 2, monitored: true });

    expect(result).toEqual({ ok: true });
    expect(mocks.editSeries).toHaveBeenCalledTimes(1);
    expect(mocks.editSeries.mock.calls[0][0]).toStrictEqual({ seriesIds: [5, 6], qualityProfileId: 2, monitored: true });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("omits fields that were not sent", async () => {
    await updateSeries({ seriesIds: [5], qualityProfileId: 1 });
    expect(mocks.editSeries.mock.calls[0][0]).toStrictEqual({ seriesIds: [5], qualityProfileId: 1 });
  });
});

describe("removeSeries authorization", () => {
  const input = { seriesIds: [1], deleteFiles: false, addImportListExclusion: false, confirmCount: 1 };

  it("checks for the admin role", async () => {
    await removeSeries(input);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects a requester and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(403));

    const result = await removeSeries(input);

    expect(result).toEqual({ ok: false, error: DELETE_DENIED });
    expect(mocks.deleteSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rejects a signed-out caller (401) and never calls Sonarr", async () => {
    mocks.requireRole.mockRejectedValue(new AuthzError(401));

    const result = await removeSeries(input);

    expect(result).toEqual({ ok: false, error: DELETE_DENIED });
    expect(mocks.deleteSeries).not.toHaveBeenCalled();
  });

  it("rethrows errors that are not authorization failures", async () => {
    mocks.requireRole.mockRejectedValue(new Error("database down"));

    await expect(removeSeries(input)).rejects.toThrow("database down");
    expect(mocks.deleteSeries).not.toHaveBeenCalled();
  });
});

describe("removeSeries input validation", () => {
  const valid = { seriesIds: [1, 2], deleteFiles: false, addImportListExclusion: false, confirmCount: 2 };
  const without = (key: string) => {
    const copy: Record<string, unknown> = { ...valid };
    delete copy[key];
    return copy;
  };

  const invalid: [string, unknown][] = [
    ["not an object", "series"],
    ["null", null],
    ["missing deleteFiles", without("deleteFiles")],
    ["missing addImportListExclusion", without("addImportListExclusion")],
    ["missing confirmCount", without("confirmCount")],
    ["a string boolean for deleteFiles", { ...valid, deleteFiles: "true" }],
    ["a string boolean for addImportListExclusion", { ...valid, addImportListExclusion: "false" }],
    ["the Radarr name addImportExclusion", { ...valid, addImportExclusion: false }],
    ["an extra key moveFiles", { ...valid, moveFiles: true }],
    ["an extra key qualityProfileId", { ...valid, qualityProfileId: 1 }],
    ["empty seriesIds", { ...valid, seriesIds: [], confirmCount: 0 }],
    ["a negative id", { ...valid, seriesIds: [-1, 2] }],
    ["a zero id", { ...valid, seriesIds: [0, 2] }],
    ["a string id", { ...valid, seriesIds: ["1", 2] }],
    ["a fractional id", { ...valid, seriesIds: [1.5, 2] }],
    ["a zero confirmCount", { ...valid, confirmCount: 0 }],
    ["a string confirmCount", { ...valid, confirmCount: "2" }],
    ["more than 2000 ids", { ...valid, seriesIds: Array.from({ length: 2001 }, (_, i) => i + 1), confirmCount: 2001 }],
    ["a confirmCount larger than the ids", { ...valid, confirmCount: 3 }],
    ["a confirmCount smaller than the ids", { ...valid, confirmCount: 1 }],
    ["duplicates that make the unique count differ", { ...valid, seriesIds: [1, 1, 2], confirmCount: 3 }],
    ["a confirmCount equal to the raw count but not the unique count", { ...valid, seriesIds: [1, 1], confirmCount: 2 }],
  ];

  it.each(invalid)("rejects %s without calling Sonarr", async (_name, input) => {
    const result = await removeSeries(input);

    expect(result).toEqual({ ok: false, error: "Invalid delete." });
    expect(mocks.deleteSeries).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("accepts exactly 2000 ids", async () => {
    const seriesIds = Array.from({ length: 2000 }, (_, i) => i + 1);
    const result = await removeSeries({ seriesIds, deleteFiles: true, addImportListExclusion: true, confirmCount: 2000 });
    expect(result).toEqual({ ok: true, deleted: 2000 });
    expect(mocks.deleteSeries).toHaveBeenCalledWith({ seriesIds, deleteFiles: true, addImportListExclusion: true });
  });

  it("does not put Zod details in the error", async () => {
    const result = await removeSeries({ ...valid, moveFiles: true });
    expect(JSON.stringify(result)).not.toMatch(/Unrecognized|received|issues|path/);
  });
});

describe("removeSeries deletes", () => {
  it("de-duplicates ids and checks the count against the unique ids", async () => {
    const result = await removeSeries({ seriesIds: [3, 1, 3, 2, 1], deleteFiles: false, addImportListExclusion: true, confirmCount: 3 });

    expect(result).toEqual({ ok: true, deleted: 3 });
    expect(mocks.deleteSeries).toHaveBeenCalledWith({ seriesIds: [3, 1, 2], deleteFiles: false, addImportListExclusion: true });
  });

  it("on success calls deleteSeries with exactly the validated fields, then refreshes", async () => {
    const result = await removeSeries({ seriesIds: [5, 6], deleteFiles: true, addImportListExclusion: false, confirmCount: 2 });

    expect(result).toEqual({ ok: true, deleted: 2 });
    expect(mocks.deleteSeries).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSeries.mock.calls[0][0]).toStrictEqual({ seriesIds: [5, 6], deleteFiles: true, addImportListExclusion: false });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("never edits, only deletes", async () => {
    await removeSeries({ seriesIds: [1], deleteFiles: false, addImportListExclusion: false, confirmCount: 1 });
    expect(mocks.editSeries).not.toHaveBeenCalled();
    expect(mocks.listSeriesQualityProfiles).not.toHaveBeenCalled();
  });

  it("gives the friendly error when Sonarr rejects the delete, and logs only the safe message", async () => {
    mocks.deleteSeries.mockRejectedValue(new ArrRequestError("Sonarr series delete request failed: HTTP 500"));

    const result = await removeSeries({ seriesIds: [1], deleteFiles: false, addImportListExclusion: false, confirmCount: 1 });

    expect(result).toEqual({
      ok: false,
      error: "Sonarr didn't confirm the delete, so some series may already be gone. The table has been refreshed; check it before trying again.",
    });
    expect(console.error).toHaveBeenCalledWith("Series delete: Sonarr series delete request failed: HTTP 500");
    // Sonarr may have deleted some anyway, so the table is re-read even on failure.
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("says a timed-out delete may still be running, and refreshes", async () => {
    mocks.deleteSeries.mockRejectedValue(new ArrRequestError("Sonarr series delete request failed: timed out", "timeout"));

    const result = await removeSeries({ seriesIds: [1], deleteFiles: true, addImportListExclusion: false, confirmCount: 1 });

    expect(result).toEqual({
      ok: false,
      error: "Sonarr is taking a long time and may still be deleting. The table has been refreshed; check it before trying again.",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("rethrows errors that are not Sonarr request failures", async () => {
    mocks.deleteSeries.mockRejectedValue(new Error("config broken"));
    await expect(removeSeries({ seriesIds: [1], deleteFiles: false, addImportListExclusion: false, confirmCount: 1 })).rejects.toThrow(
      "config broken",
    );
  });
});

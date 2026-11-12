import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import episodes from "./__fixtures__/sonarr-episodes-files.json";

vi.mock("@/server/settings/connections", () => ({
  getConnection: () => ({ url: "http://sonarr.test:8989", apiKey: "fake-api-key-0123456789abcdefghi" }),
}));

import { deleteEpisodeFiles, getDeleteSettings, planFileDelete, unmonitorEpisodes } from "./episode-files";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const series = {
  id: 10,
  monitored: true,
  seasons: [
    { seasonNumber: 1, monitored: true },
    { seasonNumber: 2, monitored: false },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function replyWithSeriesAndEpisodes() {
  fetchMock.mockImplementation((request: Request) =>
    Promise.resolve(new URL(request.url).pathname.endsWith("/episode") ? json(episodes) : json(series)),
  );
}

describe("planFileDelete", () => {
  beforeEach(replyWithSeriesAndEpisodes);

  it("plans a season: distinct files, every episode holding them, total size counted once per file", async () => {
    const plan = await planFileDelete(10, { seasonNumber: 1 });
    expect(plan.fileIds).toEqual([5001, 5002]);
    expect(plan.episodes.map((e) => e.id)).toEqual([301, 302, 303]);
    expect(plan.totalSize).toBe(3000);
    // Series and season monitored; the episode's own flag decides.
    expect(plan.episodes.map((e) => e.wanted)).toEqual([true, false, true]);
  });

  it("pulls in the sibling that shares a multi-episode file", async () => {
    const plan = await planFileDelete(10, { episodeId: 302 });
    expect(plan.fileIds).toEqual([5002]);
    expect(plan.episodes.map((e) => e.id)).toEqual([302, 303]);
    expect(plan.totalSize).toBe(2000);
  });

  it("is not wanted when the season is unmonitored", async () => {
    const plan = await planFileDelete(10, { seasonNumber: 2 });
    expect(plan.episodes).toMatchObject([{ id: 401, wanted: false }]);
  });

  it("gives an empty plan for an episode without a file", async () => {
    expect(await planFileDelete(10, { episodeId: 304 })).toEqual({ fileIds: [], episodes: [], totalSize: 0 });
  });
});

describe("getDeleteSettings", () => {
  it("keeps only the two booleans, never the Recycle Bin path", async () => {
    fetchMock.mockResolvedValue(
      json({ autoUnmonitorPreviouslyDownloadedEpisodes: true, recycleBin: "/invented/recycle", other: 1 }),
    );
    const settings = await getDeleteSettings();
    expect(settings).toEqual({ sonarrUnmonitorsDeleted: true, recycleBinSet: true });
  });

  it("reads an empty Recycle Bin as not set", async () => {
    fetchMock.mockResolvedValue(json({ autoUnmonitorPreviouslyDownloadedEpisodes: false, recycleBin: "" }));
    expect(await getDeleteSettings()).toEqual({ sonarrUnmonitorsDeleted: false, recycleBinSet: false });
  });
});

describe("deleteEpisodeFiles", () => {
  it("sends DELETE with exactly the file ids", async () => {
    fetchMock.mockResolvedValue(json({}));
    await deleteEpisodeFiles([5001, 5002]);
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/api/v3/episodefile/bulk");
    expect(await request.json()).toEqual({ episodeFileIds: [5001, 5002] });
  });

  it("throws on an empty list without a request", async () => {
    await expect(deleteEpisodeFiles([])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("unmonitorEpisodes", () => {
  it("sends PUT with the ids and monitored false", async () => {
    fetchMock.mockResolvedValue(json([]));
    await unmonitorEpisodes([302, 303]);
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.method).toBe("PUT");
    expect(await request.json()).toEqual({ episodeIds: [302, 303], monitored: false });
  });
});

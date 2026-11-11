import "server-only";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/diskspace.json";

const { FAKE_KEY, fakeConnections } = vi.hoisted(() => {
  const key = "fake-api-key-0123456789abcdefghi"; // 32 chars, not a real secret
  return {
    FAKE_KEY: key,
    fakeConnections: {
      radarr: { url: "http://radarr.test:7878", apiKey: key },
      sonarr: { url: "http://sonarr.test:8989", apiKey: key },
    },
  };
});

vi.mock("@/server/settings/connections", () => ({
  getConnection: (app: "radarr" | "sonarr") => fakeConnections[app],
}));

import { getRadarrDiskSpace, getSonarrDiskSpace } from "./disk-space";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  { name: "Radarr", host: "http://radarr.test:7878", getDisks: getRadarrDiskSpace },
  { name: "Sonarr", host: "http://sonarr.test:8989", getDisks: getSonarrDiskSpace },
])("$name disk space", ({ name, host, getDisks }) => {
  it("calls /api/v3/diskspace with the key in a header", async () => {
    fetchMock.mockResolvedValue(json(fixture));

    await getDisks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = fetchMock.mock.calls[0][0] as Request;
    const url = new URL(req.url);
    expect(`${url.protocol}//${url.host}`).toBe(host);
    expect(url.pathname).toBe("/api/v3/diskspace");
    expect(req.headers.get("X-Api-Key")).toBe(FAKE_KEY);
  });

  it("returns only the four fields, turns a missing or empty label into null, and drops unusable disks", async () => {
    fetchMock.mockResolvedValue(json(fixture));

    const disks = await getDisks();

    expect(disks).toEqual([
      { path: "C:\\", label: null, freeSpace: 250000000000, totalSpace: 500000000000 },
      { path: "D:\\", label: "Media", freeSpace: 1000000000000, totalSpace: 4000000000000 },
      { path: "\\\\nas.example.test\\movies", label: null, freeSpace: 2000000000000, totalSpace: 8000000000000 },
    ]);
  });

  it("throws an ArrRequestError on a non-OK response", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(getDisks()).rejects.toMatchObject({
      name: "ArrRequestError",
      message: `${name} disk space request failed: HTTP 500`,
    });
  });

  it("throws an invalid-reply error when the reply isn't a list", async () => {
    fetchMock.mockResolvedValue(json({ not: "a list" }));

    await expect(getDisks()).rejects.toMatchObject({ name: "ArrRequestError", kind: "invalid" });
  });
});

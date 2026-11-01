import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, requireRole } from "@/server/authz";
import { getTvdbPoster } from "@/server/arr/series-add";
import { ArrRequestError } from "@/server/arr/request";
import { GET } from "./route";

vi.mock("@/server/env", () => ({ env: () => ({}) }));

vi.mock("@/server/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/authz")>();
  return { ...actual, requireRole: vi.fn() };
});

// connection() only works inside a real request; the handler logic is what we test here.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

// Keep the real TVDB_POSTER_PATH pattern; only the upstream fetch is replaced.
vi.mock("@/server/arr/series-add", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/arr/series-add")>()),
  getTvdbPoster: vi.fn(),
}));

const requireRoleMock = vi.mocked(requireRole);
const posterMock = vi.mocked(getTvdbPoster);

const ADMIN = { user: { id: "u", email: "e", name: "n", role: "admin" as const } };
const PATH = "banners/v4/series/81189/posters/5f2e8d5ae9d1c.jpg";

function call(segments: string[]) {
  return GET(new Request("http://localhost/api/tv/lookup-poster/x"), { params: Promise.resolve({ path: segments }) });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("GET /api/tv/lookup-poster/[...path]", () => {
  it.each([401, 403] as const)("returns the authz response with status %i and does not call upstream", async (status) => {
    requireRoleMock.mockRejectedValue(new AuthzError(status));
    const res = await call(PATH.split("/"));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: status === 401 ? "unauthorized" : "forbidden" });
    expect(posterMock).not.toHaveBeenCalled();
  });

  it("checks for admin or requester role", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    posterMock.mockResolvedValue(new Uint8Array([0xff]));
    await call(PATH.split("/"));
    expect(requireRoleMock).toHaveBeenCalledWith("admin", "requester");
  });

  it.each([
    ["..", "secret.jpg"],
    ["banners", "..", "..", "x.jpg"],
    ["banners", "v4", "series", "81189", "posters", "a.png"],
    ["banners", "v4", "series", "81189", "posters", "abc.JPG"],
    ["banners", "posters", "abc.jpg.exe"],
    ["banners", "posters", "abc"],
    ["other", "posters", "abc.jpg"],
    ["banners", "a", "b", "c", "d", "e", "f", "abc.jpg"],
    ["banners", "posters", `${"a".repeat(65)}.jpg`],
    ["banners", "posters", "abc;def.jpg"],
    ["banners", "posters", "abc%2Fdef.jpg"],
  ])("returns 404 for path %j without calling upstream", async (...segments) => {
    requireRoleMock.mockResolvedValue(ADMIN);
    const res = await call(segments);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(posterMock).not.toHaveBeenCalled();
  });

  it("returns 200 with the image bytes and only the three headers for a valid path", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    posterMock.mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff]));
    const res = await call(PATH.split("/"));
    expect(res.status).toBe(200);
    expect(posterMock).toHaveBeenCalledWith(PATH);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=604800");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect([...res.headers.keys()].sort()).toEqual(["cache-control", "content-type", "x-content-type-options"]);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff]);
  });

  it("returns 502 with a fixed body, without the upstream message, and logs one line", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    posterMock.mockRejectedValue(new ArrRequestError("TVDB poster request failed: HTTP 404", "http", 404));
    const res = await call(PATH.split("/"));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "poster unavailable" });
    expect(text).not.toContain("HTTP 404");
    expect(text).not.toContain("TVDB");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[tv-lookup-poster] TVDB poster request failed: HTTP 404");
  });

  it("rethrows errors that are not ArrRequestError", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    posterMock.mockRejectedValue(new Error("unexpected"));
    await expect(call(PATH.split("/"))).rejects.toThrow("unexpected");
  });
});

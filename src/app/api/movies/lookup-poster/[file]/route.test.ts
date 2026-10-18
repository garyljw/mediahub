import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, requireRole } from "@/server/authz";
import { getTmdbPoster } from "@/server/arr/movie-add";
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

// Keep the real TMDB_POSTER_FILE pattern; only the upstream fetch is replaced.
vi.mock("@/server/arr/movie-add", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/arr/movie-add")>()),
  getTmdbPoster: vi.fn(),
}));

const requireRoleMock = vi.mocked(requireRole);
const posterMock = vi.mocked(getTmdbPoster);

const ADMIN = { user: { id: "u", email: "e", name: "n", role: "admin" as const } };
const FILE = "vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg";

function call(file: string) {
  return GET(new Request("http://localhost/api/movies/lookup-poster/x"), { params: Promise.resolve({ file }) });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("GET /api/movies/lookup-poster/[file]", () => {
  it.each([401, 403] as const)("returns the authz response with status %i and does not call upstream", async (status) => {
    requireRoleMock.mockRejectedValue(new AuthzError(status));
    const res = await call(FILE);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: status === 401 ? "unauthorized" : "forbidden" });
    expect(posterMock).not.toHaveBeenCalled();
  });

  it("checks for admin or requester role", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    posterMock.mockResolvedValue(new Uint8Array([0xff]));
    await call(FILE);
    expect(requireRoleMock).toHaveBeenCalledWith("admin", "requester");
  });

  it.each([
    "..%2Fsecret.jpg",
    "..%2F..%2Fetc%2Fpasswd",
    "a.png",
    "abc.JPG",
    "abc.jpg.exe",
    "abc",
    `${"a".repeat(65)}.jpg`,
    "abc%2Fdef.jpg",
    "abc;def.jpg",
  ])("returns 404 for name %j without calling upstream", async (file) => {
    requireRoleMock.mockResolvedValue(ADMIN);
    const res = await call(file);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(posterMock).not.toHaveBeenCalled();
  });

  it("returns 200 with the image bytes and only the three headers for a valid name", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    posterMock.mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff]));
    const res = await call(FILE);
    expect(res.status).toBe(200);
    expect(posterMock).toHaveBeenCalledWith(FILE);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=604800");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect([...res.headers.keys()].sort()).toEqual(["cache-control", "content-type", "x-content-type-options"]);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff]);
  });

  it("returns 502 with a fixed body, without the upstream message, and logs one line", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    posterMock.mockRejectedValue(new ArrRequestError("TMDB poster request failed: HTTP 404", "http", 404));
    const res = await call(FILE);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "poster unavailable" });
    expect(text).not.toContain("HTTP 404");
    expect(text).not.toContain("TMDB");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[lookup-poster] TMDB poster request failed: HTTP 404");
  });

  it("rethrows errors that are not ArrRequestError", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    posterMock.mockRejectedValue(new Error("unexpected"));
    await expect(call(FILE)).rejects.toThrow("unexpected");
  });
});

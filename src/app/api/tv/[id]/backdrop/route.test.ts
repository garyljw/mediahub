import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, requireRole } from "@/server/authz";
import { getSeriesBackdrop } from "@/server/arr/series";
import { ArrRequestError } from "@/server/arr/request";
import { GET } from "./route";

vi.mock("@/server/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/authz")>();
  return { ...actual, requireRole: vi.fn() };
});

// connection() only works inside a real request; the handler logic is what we test here.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

vi.mock("@/server/arr/series", () => ({
  getSeriesBackdrop: vi.fn(),
}));

const requireRoleMock = vi.mocked(requireRole);
const backdropMock = vi.mocked(getSeriesBackdrop);

const ADMIN = { user: { id: "u", email: "e", name: "n", role: "admin" as const } };

function call(id: string) {
  return GET(new Request("http://localhost/api/tv/1/backdrop"), { params: Promise.resolve({ id }) });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("GET /api/tv/[id]/backdrop", () => {
  it.each([401, 403] as const)("returns the authz response with status %i and does not call upstream", async (status) => {
    requireRoleMock.mockRejectedValue(new AuthzError(status));
    const res = await call("42");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: status === 401 ? "unauthorized" : "forbidden" });
    expect(backdropMock).not.toHaveBeenCalled();
  });

  it("checks for admin or requester role", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    backdropMock.mockResolvedValue(new Uint8Array([0xff]));
    await call("42");
    expect(requireRoleMock).toHaveBeenCalledWith("admin", "requester");
  });

  it.each(["0", "-1", "abc", "1.5", "1e3", " 1", "01", "99999999999", "2147483648"])(
    "returns 400 for id %j without calling upstream",
    async (id) => {
      requireRoleMock.mockResolvedValue(ADMIN);
      const res = await call(id);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid id" });
      expect(backdropMock).not.toHaveBeenCalled();
    },
  );

  it("returns 200 with the image bytes and only the three headers for a valid id", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    backdropMock.mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff]));
    const res = await call("42");
    expect(res.status).toBe(200);
    expect(backdropMock).toHaveBeenCalledWith(42);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect([...res.headers.keys()].sort()).toEqual(["cache-control", "content-type", "x-content-type-options"]);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff]);
  });

  it("accepts the largest valid id", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    backdropMock.mockResolvedValue(new Uint8Array([0xff]));
    const res = await call("2147483647");
    expect(res.status).toBe(200);
    expect(backdropMock).toHaveBeenCalledWith(2147483647);
  });

  it("returns 502 with a fixed body, without the upstream message, and logs one line", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    backdropMock.mockRejectedValue(new ArrRequestError("Sonarr backdrop request failed: HTTP 404", "http"));
    const res = await call("42");
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "poster unavailable" });
    expect(text).not.toContain("HTTP 404");
    expect(text).not.toContain("Sonarr");
    expect(text).not.toContain("backdrop");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[backdrop] Sonarr backdrop request failed: HTTP 404");
  });

  it("rethrows errors that are not ArrRequestError", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    backdropMock.mockRejectedValue(new Error("Invalid environment configuration: RADARR_URL"));
    await expect(call("42")).rejects.toThrow("Invalid environment configuration");
  });
});

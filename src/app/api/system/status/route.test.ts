import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, requireRole } from "@/server/authz";
import { getRadarrStatus, getSonarrStatus } from "@/server/arr/system";
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

vi.mock("@/server/arr/system", () => ({
  getRadarrStatus: vi.fn(),
  getSonarrStatus: vi.fn(),
}));

const requireRoleMock = vi.mocked(requireRole);
const radarrMock = vi.mocked(getRadarrStatus);
const sonarrMock = vi.mocked(getSonarrStatus);

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("GET /api/system/status", () => {
  it("returns 401 without a session and does not call upstream", async () => {
    requireRoleMock.mockRejectedValue(new AuthzError(401));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(radarrMock).not.toHaveBeenCalled();
    expect(sonarrMock).not.toHaveBeenCalled();
  });

  it("checks for admin or requester role", async () => {
    requireRoleMock.mockResolvedValue({ user: { id: "u", email: "e", name: "n", role: "requester" } });
    radarrMock.mockResolvedValue({ version: "6.0.0", appName: "Radarr" });
    sonarrMock.mockResolvedValue({ version: "4.0.0", appName: "Sonarr" });
    await GET();
    expect(requireRoleMock).toHaveBeenCalledWith("admin", "requester");
  });

  it("returns 200 with only the trimmed shape when both services are up", async () => {
    requireRoleMock.mockResolvedValue({ user: { id: "u", email: "e", name: "n", role: "admin" } });
    radarrMock.mockResolvedValue({ version: "6.0.0", appName: "Radarr" });
    sonarrMock.mockResolvedValue({ version: "4.0.0", appName: "Sonarr" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      radarr: { ok: true, version: "6.0.0" },
      sonarr: { ok: true, version: "4.0.0" },
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns 502 without leaking error text, and logs one server-side line", async () => {
    requireRoleMock.mockResolvedValue({ user: { id: "u", email: "e", name: "n", role: "admin" } });
    radarrMock.mockResolvedValue({ version: "6.0.0", appName: "Radarr" });
    sonarrMock.mockRejectedValue(new Error("Sonarr status request failed: HTTP 401"));
    const res = await GET();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      radarr: { ok: true, version: "6.0.0" },
      sonarr: { ok: false },
    });
    expect(text).not.toContain("HTTP 401");
    expect(text).not.toContain("request failed");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[status] Sonarr failed:", "Sonarr status request failed: HTTP 401");
  });

  it("logs 'unknown error' for a rejection that is not an Error", async () => {
    requireRoleMock.mockResolvedValue({ user: { id: "u", email: "e", name: "n", role: "admin" } });
    radarrMock.mockRejectedValue("string rejection");
    sonarrMock.mockResolvedValue({ version: "4.0.0", appName: "Sonarr" });
    const res = await GET();
    expect(res.status).toBe(502);
    expect(errorSpy).toHaveBeenCalledWith("[status] Radarr failed:", "unknown error");
  });
});

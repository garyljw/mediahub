import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, requireRole } from "@/server/authz";
import { listMovieActivity } from "@/server/arr/activity";
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

vi.mock("@/server/arr/activity", () => ({
  listMovieActivity: vi.fn(),
}));

const requireRoleMock = vi.mocked(requireRole);
const activityMock = vi.mocked(listMovieActivity);

const ADMIN = { user: { id: "u", email: "e", name: "n", role: "admin" as const } };
const REQUESTER = { user: { id: "r", email: "e", name: "n", role: "requester" as const } };

const ITEM = {
  movieId: 42,
  state: "downloading" as const,
  severity: "ok" as const,
  progress: 50,
  etaSeconds: 600,
  messages: [],
  count: 1,
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("GET /api/movies/activity", () => {
  it.each([401, 403] as const)("returns the authz response with status %i and does not call upstream", async (status) => {
    requireRoleMock.mockRejectedValue(new AuthzError(status));
    const res = await GET();
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: status === 401 ? "unauthorized" : "forbidden" });
    expect(activityMock).not.toHaveBeenCalled();
  });

  it("checks for admin or requester role", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    activityMock.mockResolvedValue([]);
    await GET();
    expect(requireRoleMock).toHaveBeenCalledWith("admin", "requester");
  });

  it("asks for messages when the user is an admin", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    activityMock.mockResolvedValue([]);
    await GET();
    expect(activityMock).toHaveBeenCalledWith({ includeMessages: true });
  });

  it("does not ask for messages when the user is a requester", async () => {
    requireRoleMock.mockResolvedValue(REQUESTER);
    activityMock.mockResolvedValue([]);
    await GET();
    expect(activityMock).toHaveBeenCalledWith({ includeMessages: false });
  });

  it("returns 200 with { items } and no-store caching", async () => {
    requireRoleMock.mockResolvedValue(REQUESTER);
    activityMock.mockResolvedValue([ITEM]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ items: [ITEM] });
  });

  it("returns 502 with a fixed body, without the upstream message, and logs one line", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    activityMock.mockRejectedValue(new ArrRequestError("Radarr queue request failed: HTTP 500", "http", 500));
    const res = await GET();
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "activity unavailable" });
    expect(text).not.toContain("HTTP 500");
    expect(text).not.toContain("Radarr");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[activity] Radarr queue request failed: HTTP 500");
  });

  it("rethrows errors that are not ArrRequestError", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    activityMock.mockRejectedValue(new Error("Invalid environment configuration: RADARR_URL"));
    await expect(GET()).rejects.toThrow("Invalid environment configuration");
  });
});

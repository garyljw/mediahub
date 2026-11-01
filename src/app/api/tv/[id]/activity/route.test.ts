import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, requireRole } from "@/server/authz";
import { listEpisodeActivity } from "@/server/arr/activity";
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
  listEpisodeActivity: vi.fn(),
}));

const requireRoleMock = vi.mocked(requireRole);
const activityMock = vi.mocked(listEpisodeActivity);

const ADMIN = { user: { id: "u", email: "e", name: "n", role: "admin" as const } };
const REQUESTER = { user: { id: "r", email: "e", name: "n", role: "requester" as const } };

const ITEM = {
  id: 101,
  state: "downloading" as const,
  severity: "ok" as const,
  progress: 50,
  etaSeconds: 600,
  messages: [],
  count: 1,
};

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("GET /api/tv/[id]/activity", () => {
  it.each([401, 403] as const)("returns the authz response with status %i and does not call upstream", async (status) => {
    requireRoleMock.mockRejectedValue(new AuthzError(status));
    const res = await GET(new Request("http://localhost/"), context("10"));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: status === 401 ? "unauthorized" : "forbidden" });
    expect(activityMock).not.toHaveBeenCalled();
  });

  it("checks for admin or requester role", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    activityMock.mockResolvedValue([]);
    await GET(new Request("http://localhost/"), context("10"));
    expect(requireRoleMock).toHaveBeenCalledWith("admin", "requester");
  });

  it("asks for messages when the user is an admin", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    activityMock.mockResolvedValue([]);
    await GET(new Request("http://localhost/"), context("10"));
    expect(activityMock).toHaveBeenCalledWith(10, { includeMessages: true });
  });

  it("does not ask for messages when the user is a requester", async () => {
    requireRoleMock.mockResolvedValue(REQUESTER);
    activityMock.mockResolvedValue([]);
    await GET(new Request("http://localhost/"), context("10"));
    expect(activityMock).toHaveBeenCalledWith(10, { includeMessages: false });
  });

  it.each(["abc", "0", "-1", "1e3", "1234567890", "1.5", " 10"])(
    "returns 400 for the id %j without calling upstream",
    async (id) => {
      requireRoleMock.mockResolvedValue(ADMIN);
      const res = await GET(new Request("http://localhost/"), context(id));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid id" });
      expect(activityMock).not.toHaveBeenCalled();
    },
  );

  it("passes a valid id through as a number", async () => {
    requireRoleMock.mockResolvedValue(REQUESTER);
    activityMock.mockResolvedValue([ITEM]);
    await GET(new Request("http://localhost/"), context("123456789"));
    expect(activityMock).toHaveBeenCalledWith(123456789, { includeMessages: false });
  });

  it("returns 200 with { items } and no-store caching", async () => {
    requireRoleMock.mockResolvedValue(REQUESTER);
    activityMock.mockResolvedValue([ITEM]);
    const res = await GET(new Request("http://localhost/"), context("10"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ items: [ITEM] });
  });

  it("returns 502 with a fixed body, without the upstream message, and logs one line", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    activityMock.mockRejectedValue(new ArrRequestError("Sonarr queue request failed: HTTP 500", "http", 500));
    const res = await GET(new Request("http://localhost/"), context("10"));
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "activity unavailable" });
    expect(text).not.toContain("HTTP 500");
    expect(text).not.toContain("Sonarr");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[tv-episode-activity] Sonarr queue request failed: HTTP 500");
  });

  it("rethrows errors that are not ArrRequestError", async () => {
    requireRoleMock.mockResolvedValue(ADMIN);
    activityMock.mockRejectedValue(new Error("Invalid environment configuration: SONARR_URL"));
    await expect(GET(new Request("http://localhost/"), context("10"))).rejects.toThrow("Invalid environment configuration");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, requireRole } from "@/server/authz";
import { getSeriesPeek } from "@/server/arr/series";
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
  getSeriesPeek: vi.fn(),
}));

const requireRoleMock = vi.mocked(requireRole);
const peekMock = vi.mocked(getSeriesPeek);

const REQUESTER = { user: { id: "r", email: "e", name: "n", role: "requester" as const } };

const PEEK = { year: 2001, genres: ["Drama"], overview: "A made-up plot." };

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

describe("GET /api/tv/[id]/peek", () => {
  it.each([401, 403] as const)("returns the authz response with status %i and does not call upstream", async (status) => {
    requireRoleMock.mockRejectedValue(new AuthzError(status));
    const res = await GET(new Request("http://localhost/"), context("10"));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: status === 401 ? "unauthorized" : "forbidden" });
    expect(peekMock).not.toHaveBeenCalled();
  });

  it("checks for admin or requester role", async () => {
    requireRoleMock.mockResolvedValue(REQUESTER);
    peekMock.mockResolvedValue(PEEK);
    await GET(new Request("http://localhost/"), context("10"));
    expect(requireRoleMock).toHaveBeenCalledWith("admin", "requester");
  });

  it.each(["abc", "0", "-1", "1e3", "1234567890", "1.5", " 10"])(
    "returns 400 for the id %j without calling upstream",
    async (id) => {
      requireRoleMock.mockResolvedValue(REQUESTER);
      const res = await GET(new Request("http://localhost/"), context(id));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid id" });
      expect(peekMock).not.toHaveBeenCalled();
    },
  );

  it("passes a valid id through as a number", async () => {
    requireRoleMock.mockResolvedValue(REQUESTER);
    peekMock.mockResolvedValue(PEEK);
    await GET(new Request("http://localhost/"), context("123456789"));
    expect(peekMock).toHaveBeenCalledWith(123456789);
  });

  it("returns 200 with { peek } and a private five-minute cache", async () => {
    requireRoleMock.mockResolvedValue(REQUESTER);
    peekMock.mockResolvedValue(PEEK);
    const res = await GET(new Request("http://localhost/"), context("10"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["peek"]);
    expect(Object.keys(body.peek).sort()).toEqual(["genres", "overview", "year"]);
    expect(body.peek).toEqual(PEEK);
  });

  it("returns 200 with peek null when there is nothing to show", async () => {
    requireRoleMock.mockResolvedValue(REQUESTER);
    peekMock.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/"), context("10"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ peek: null });
  });

  it("returns 502 with a fixed body, without the upstream message, and logs one line", async () => {
    requireRoleMock.mockResolvedValue(REQUESTER);
    peekMock.mockRejectedValue(new ArrRequestError("Sonarr series request failed: HTTP 500", "http", 500));
    const res = await GET(new Request("http://localhost/"), context("10"));
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "peek unavailable" });
    expect(text).not.toContain("HTTP 500");
    expect(text).not.toContain("Sonarr");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[series-peek] Sonarr series request failed: HTTP 500");
  });

  it("rethrows errors that are not ArrRequestError", async () => {
    requireRoleMock.mockResolvedValue(REQUESTER);
    peekMock.mockRejectedValue(new Error("Sonarr isn't set up"));
    await expect(GET(new Request("http://localhost/"), context("10"))).rejects.toThrow("isn't set up");
  });
});

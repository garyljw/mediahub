import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, requireRole } from "@/server/authz";
import { noticesText } from "@/server/notices";
import { GET } from "./route";

vi.mock("@/server/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/authz")>();
  return { ...actual, requireRole: vi.fn() };
});

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

vi.mock("@/server/notices", () => ({ noticesText: vi.fn() }));

const requireRoleMock = vi.mocked(requireRole);
const noticesTextMock = vi.mocked(noticesText);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/about/licences", () => {
  it("returns 401 without a session and reads nothing", async () => {
    requireRoleMock.mockRejectedValue(new AuthzError(401));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(noticesTextMock).not.toHaveBeenCalled();
  });

  it("allows admin and requester", async () => {
    requireRoleMock.mockResolvedValue({ user: { id: "u", email: "e", name: "n", role: "requester" } });
    noticesTextMock.mockReturnValue("text");
    await GET();
    expect(requireRoleMock).toHaveBeenCalledWith("admin", "requester");
  });

  it("returns the text as plain text with nosniff", async () => {
    requireRoleMock.mockResolvedValue({ user: { id: "u", email: "e", name: "n", role: "admin" } });
    noticesTextMock.mockReturnValue("THIRD-PARTY NOTICES\n");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe("THIRD-PARTY NOTICES\n");
  });

  it("returns 404 when the file is missing", async () => {
    requireRoleMock.mockResolvedValue({ user: { id: "u", email: "e", name: "n", role: "admin" } });
    noticesTextMock.mockReturnValue(null);
    const res = await GET();
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });
});

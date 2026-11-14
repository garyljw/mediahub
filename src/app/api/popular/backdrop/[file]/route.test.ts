import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, requireRole } from "@/server/authz";
import { getTmdbBackdrop } from "@/server/arr/movie-add";
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
  getTmdbBackdrop: vi.fn(),
}));

const requireRoleMock = vi.mocked(requireRole);
const backdropMock = vi.mocked(getTmdbBackdrop);
const FILE = "twiVn9oFXOVR0uoYgawyEBlnFu8.jpg";

function call(file: string) {
  return GET(new Request("http://localhost/api/popular/backdrop/x"), { params: Promise.resolve({ file }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/popular/backdrop/[file]", () => {
  it.each([401, 403] as const)("returns the authz response with status %i and does not call upstream", async (status) => {
    requireRoleMock.mockRejectedValue(new AuthzError(status));
    expect((await call(FILE)).status).toBe(status);
    expect(backdropMock).not.toHaveBeenCalled();
  });

  it.each(["..%2Fsecret.jpg", "a.png", "abc.jpg.exe", `${"a".repeat(65)}.jpg`, "abc%2Fdef.jpg"])(
    "returns 404 for name %j without calling upstream",
    async (file) => {
      requireRoleMock.mockResolvedValue({ user: { id: "u", email: "e", name: "n", role: "admin" as const } });
      expect((await call(file)).status).toBe(404);
      expect(backdropMock).not.toHaveBeenCalled();
    },
  );

  it("checks for admin or requester and serves the image for a valid name", async () => {
    requireRoleMock.mockResolvedValue({ user: { id: "u", email: "e", name: "n", role: "requester" as const } });
    backdropMock.mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff]));
    const res = await call(FILE);
    expect(requireRoleMock).toHaveBeenCalledWith("admin", "requester");
    expect(backdropMock).toHaveBeenCalledWith(FILE);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });
});

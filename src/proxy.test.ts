import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

// The public origin the redirect must point at. request.url below is a different, internal host.
const PUBLIC_ORIGIN = "https://mediahub.example.test";
const INTERNAL_ORIGIN = "http://192.168.10.5:3000";

vi.mock("@/server/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://mediahub.example.test" }) }));

function request(path: string, cookie?: string) {
  return new NextRequest(`${INTERNAL_ORIGIN}${path}`, cookie ? { headers: { cookie } } : undefined);
}

describe("proxy", () => {
  it("answers anonymous visits with a 307 to /login on the public origin", () => {
    const res = proxy(request("/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${PUBLIC_ORIGIN}/login`);
  });

  it("lets requests with a session cookie through", () => {
    const res = proxy(request("/", "better-auth.session_token=abc"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("accepts the __Secure- cookie name used on https", () => {
    const res = proxy(request("/", "__Secure-better-auth.session_token=abc"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not treat other cookies as a session", () => {
    const res = proxy(request("/", "better-auth.session_data=abc; other=1"));
    expect(res.status).toBe(307);
  });
});

describe("proxy matcher", () => {
  // Next ships a helper that applies a config.matcher the way the router does. It
  // needs Next's AsyncLocalStorage global, which only the Next runtime sets, so the
  // test sets it. The import is dynamic so the global exists before the module loads.
  async function matches(path: string) {
    (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
    const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server");
    return unstable_doesMiddlewareMatch({ config, url: `${INTERNAL_ORIGIN}${path}` });
  }

  it("covers app pages, including the root", async () => {
    expect(await matches("/")).toBe(true);
    expect(await matches("/some/page")).toBe(true);
  });

  it("excludes exactly /login and /login/...", async () => {
    expect(await matches("/login")).toBe(false);
    expect(await matches("/login/x")).toBe(false);
  });

  it("still covers paths that only start with login", async () => {
    expect(await matches("/loginhelp")).toBe(true);
  });

  it("excludes auth endpoints, route handlers, Next internals and files", async () => {
    expect(await matches("/api/auth/sign-in/email")).toBe(false);
    expect(await matches("/api/system/status")).toBe(false);
    expect(await matches("/_next/static/chunk.js")).toBe(false);
    expect(await matches("/favicon.ico")).toBe(false);
    expect(await matches("/next.svg")).toBe(false);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { email: vi.fn() } } }));

import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  it("posts, so a submit before the page's JavaScript starts never puts the password in the URL", () => {
    const html = renderToStaticMarkup(createElement(LoginForm));
    expect(html).toMatch(/<form[^>]*method="post"/);
  });
});

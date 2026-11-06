import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorPanel } from "./error-panel";

function render(error: unknown) {
  return renderToStaticMarkup(createElement(ErrorPanel, { error, retry: () => {} }));
}

describe("ErrorPanel", () => {
  it("shows the digest but never the message or stack", () => {
    const error = Object.assign(new Error("secret upstream detail"), { digest: "1516099612" });
    const html = render(error);
    expect(html).toContain("1516099612");
    expect(html).not.toContain("secret upstream detail");
    expect(html).not.toContain(error.stack?.split("\n")[1]?.trim() ?? "unreachable");
  });

  it("shows no code line when there is no digest", () => {
    const html = render(new Error("client-side detail"));
    expect(html).not.toContain("Error code");
    expect(html).not.toContain("client-side detail");
  });
});

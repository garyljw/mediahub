import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoldText } from "./bold-text";

const render = (text: string) => renderToStaticMarkup(createElement(BoldText, { text }));

describe("BoldText", () => {
  it.each([
    ["plain text", "Just text", "Just text"],
    ["a bold run in the middle", "Sort **Home** now", "Sort <strong>Home</strong> now"],
    ["an unclosed marker", "Sort **Home now", "Sort **Home now"],
    ["markup in the text", "**<b>x</b>** <i>", "<strong>&lt;b&gt;x&lt;/b&gt;</strong> &lt;i&gt;"],
  ])("renders %s", (_name, input, html) => {
    expect(render(input)).toBe(html);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backdropSvg, cachedJpeg, escapeXml, headshotSvg, posterSvg, renderJpeg, wrapTitle } from "../../../scripts/demo/art";

const NASTY = `Tom & Jerry <Live> "Quoted" 'x'`;

/** No bare & in the markup: every & starts one of the five XML entities. */
function hasBareAmpersand(svg: string): boolean {
  return /&(?!amp;|lt;|gt;|quot;|apos;)/.test(svg);
}

describe("escapeXml", () => {
  it("escapes ampersands, angle brackets and both quote marks", () => {
    expect(escapeXml(NASTY)).toBe("Tom &amp; Jerry &lt;Live&gt; &quot;Quoted&quot; &apos;x&apos;");
  });
});

describe("SVG templates", () => {
  it("escape a title with &, <, > and quotes in the poster, backdrop and headshot", () => {
    for (const svg of [posterSvg(NASTY, 2001, 1), backdropSvg(NASTY, 2), headshotSvg(NASTY, 3)]) {
      expect(hasBareAmpersand(svg)).toBe(false);
      expect(svg).not.toContain("<Live>");
      expect(svg).toContain("&lt;Live&gt;");
      expect(svg.startsWith("<svg")).toBe(true);
    }
  });

  it("make posters at 500x750 and backdrops at 1280x720", () => {
    expect(posterSvg("A", 2000, 0)).toContain('width="500" height="750"');
    expect(backdropSvg("A", 0)).toContain('width="1280" height="720"');
  });

  it("wrap long titles into at most five lines", () => {
    const lines = wrapTitle("one two three four five six seven eight nine ten eleven twelve", 10);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines.every((line) => line.length <= 10 || !line.includes(" "))).toBe(true);
  });
});

describe("renderJpeg and cachedJpeg", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "demo-art-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("renders a poster with escaped text as a JPEG, so the SVG is valid XML", async () => {
    const jpeg = await renderJpeg(posterSvg(NASTY, 2001, 4));
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
    expect(jpeg[2]).toBe(0xff);
  });

  it("reads a second render of the same SVG from the disk cache", async () => {
    const svg = posterSvg("Cached Title", 2010, 7);
    const first = await cachedJpeg(svg, dir);
    const second = await cachedJpeg(svg, dir);
    expect(second.equals(first)).toBe(true);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dir).filter((name) => name.endsWith(".jpg"))).toHaveLength(1);
  });
});

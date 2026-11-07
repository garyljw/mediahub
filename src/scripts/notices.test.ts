import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// The generator is plain .mjs under scripts/, shared with package.mjs. Vitest runs it directly.
import { allEntries, collectPackages, collectVendored, renderNotices, summarize } from "../../scripts/notices.mjs";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "notices-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes a file under root, creating folders as needed. */
function write(rel: string, content: string) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function pkgJson(fields: Record<string, unknown>) {
  return JSON.stringify(fields);
}

describe("collectPackages", () => {
  it("follows nested and root dependencies, dedupes name@version, and reads licence files", () => {
    write("package.json", pkgJson({ dependencies: { a: "1.0.0", c: "1.0.0", sharp: "1.0.0", "@img/x": "1.0.0" } }));
    // a has a LICENSE and a NOTICE, and a nested b that is not at the top level.
    write("node_modules/a/package.json", pkgJson({ name: "a", version: "1.0.0", license: "MIT", repository: { url: "git+https://example.test/a.git" }, dependencies: { b: "2.0.0" } }));
    write("node_modules/a/LICENSE", "A licence text");
    write("node_modules/a/NOTICE", "A notice");
    write("node_modules/a/README.md", "not a licence");
    write("node_modules/a/node_modules/b/package.json", pkgJson({ name: "b", version: "2.0.0", license: { type: "Apache-2.0" } }));
    // c depends on a again, which must resolve to the same root copy and appear once.
    write("node_modules/c/package.json", pkgJson({ name: "c", version: "1.0.0", license: "ISC", dependencies: { a: "1.0.0" }, optionalDependencies: { ghost: "1.0.0" } }));
    // Not shipped: sharp and anything under @img/.
    write("node_modules/sharp/package.json", pkgJson({ name: "sharp", version: "1.0.0", license: "Apache-2.0" }));
    write("node_modules/sharp/LICENSE", "sharp");
    write("node_modules/@img/x/package.json", pkgJson({ name: "@img/x", version: "1.0.0", license: "LGPL-3.0-or-later" }));

    const packages = collectPackages(root) as { name: string; version: string; licence: string; repository: string; licenceText: string }[];
    const names = packages.map((p) => `${p.name}@${p.version}`).sort();
    expect(names).toEqual(["a@1.0.0", "b@2.0.0", "c@1.0.0"]);

    const a = packages.find((p) => p.name === "a")!;
    expect(a.licence).toBe("MIT");
    expect(a.repository).toBe("https://example.test/a.git");
    expect(a.licenceText).toContain("A licence text");
    expect(a.licenceText).toContain("A notice");
    expect(a.licenceText).not.toContain("not a licence");

    expect(packages.find((p) => p.name === "b")!.licence).toBe("Apache-2.0");
    expect(packages.find((p) => p.name === "c")!.licenceText).toBe("");
  });

  it("skips an optional dependency that is not installed, but fails on a missing required one", () => {
    write("package.json", pkgJson({ dependencies: { a: "1.0.0" }, optionalDependencies: { "not-installed": "1.0.0" } }));
    write("node_modules/a/package.json", pkgJson({ name: "a", version: "1.0.0", license: "MIT", optionalDependencies: { "also-missing": "1.0.0" } }));
    expect(collectPackages(root).map((p: { name: string }) => p.name)).toEqual(["a"]);

    write("package.json", pkgJson({ dependencies: { missing: "1.0.0" } }));
    expect(() => collectPackages(root)).toThrow(/missing is a dependency but is not installed/);
  });

  it("reports UNKNOWN when a package has no licence field", () => {
    write("package.json", pkgJson({ dependencies: { a: "1.0.0" } }));
    write("node_modules/a/package.json", pkgJson({ name: "a", version: "1.0.0" }));
    expect(collectPackages(root)[0].licence).toBe("UNKNOWN");
  });
});

describe("collectVendored", () => {
  it("lists vendored folders that have a licence file, with and without package.json", () => {
    write("package.json", pkgJson({}));
    const compiled = "node_modules/next/dist/compiled";
    write(`${compiled}/foo/LICENSE`, "foo licence");
    write(`${compiled}/foo/package.json`, pkgJson({ name: "foo", version: "1.2.3", license: "MIT" }));
    write(`${compiled}/bar/LICENSE.md`, "bar licence");
    write(`${compiled}/nolicence/index.js`, "no licence here");
    write(`${compiled}/@scope/qux/NOTICE`, "qux notice");
    write(`${compiled}/@scope/qux/package.json`, pkgJson({ name: "@scope/qux", version: "0.1.0", license: "BSD-3-Clause" }));

    const vendored = collectVendored(root) as { name: string; version: string; licence: string; licenceText: string }[];
    expect(vendored.map((v) => v.name).sort()).toEqual([
      "@scope/qux (bundled inside Next.js)",
      "bar (bundled inside Next.js)",
      "foo (bundled inside Next.js)",
    ]);
    const foo = vendored.find((v) => v.name.startsWith("foo "))!;
    expect(foo).toMatchObject({ version: "1.2.3", licence: "MIT", licenceText: "foo licence" });
    const bar = vendored.find((v) => v.name.startsWith("bar "))!;
    expect(bar).toMatchObject({ version: "", licence: "UNKNOWN", licenceText: "bar licence" });
    expect(vendored.find((v) => v.name.startsWith("@scope/qux "))).toMatchObject({ version: "0.1.0", licence: "BSD-3-Clause" });
  });

  it("returns nothing when Next is not installed", () => {
    expect(collectVendored(root)).toEqual([]);
  });
});

describe("renderNotices", () => {
  const packages = [
    { name: "zeta", version: "2.0.0", licence: "MIT", repository: "https://example.test/zeta", licenceText: "zeta text\n" },
    { name: "alpha", version: "1.0.0", licence: "ISC", repository: "", licenceText: "" },
  ];
  const vendored = [{ name: "mid (bundled inside Next.js)", version: "", licence: "UNKNOWN", repository: "", licenceText: "mid text" }];
  const extras = [{ name: "Node.js", licence: "MIT and others (see text)", text: "node text" }];

  it("puts extras first, then the rest sorted by name, each with its heading and text", () => {
    const text: string = renderNotices({ packages, vendored, extras });
    const headings = text.split("\n").filter((line) => line.includes(" — "));
    expect(headings).toEqual([
      "Node.js — MIT and others (see text)",
      "alpha 1.0.0 — ISC",
      "mid (bundled inside Next.js) — UNKNOWN",
      "zeta 2.0.0 — MIT",
    ]);
    expect(text).toContain("=".repeat(80) + "\nzeta 2.0.0 — MIT\nRepository: https://example.test/zeta\n\nzeta text\n");
    expect(text).toContain("No licence file is included in this package. Licence: ISC.");
    expect(text.startsWith("THIRD-PARTY NOTICES")).toBe(true);
  });

  it("summarize gives name, version and licence sorted by name (code-unit order), extras included", () => {
    const entries = allEntries({ packages, vendored, extras });
    expect(summarize(entries)).toEqual([
      { name: "Node.js", version: "", licence: "MIT and others (see text)" },
      { name: "alpha", version: "1.0.0", licence: "ISC" },
      { name: "mid (bundled inside Next.js)", version: "", licence: "UNKNOWN" },
      { name: "zeta", version: "2.0.0", licence: "MIT" },
    ]);
  });
});

// Builds THIRD_PARTY_NOTICES.txt and THIRD_PARTY_NOTICES.json for the package (see scripts/package.mjs).
// The functions take a root folder and return plain data, so src/scripts/notices.test.ts can run them on a temp tree.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Packages the package must not ship. next.config.ts excludes them from Next's file tracing, because MediaHub
// serves plain <img> tags and never uses the image optimiser that needs sharp (and its LGPL libvips). The
// @img/ scope holds sharp's native binaries.
export const NOT_SHIPPED = ["sharp"];
const isNotShipped = (name) => NOT_SHIPPED.includes(name) || name.startsWith("@img/");

// A licence, notice or copying file at the top of a package folder, e.g. LICENSE, LICENSE.md, LICENSE-MIT,
// license_apache.txt, NOTICE.
const LICENCE_FILE = /^(licen[cs]e|copying|notice)([-_.].*)?$/i;

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function licenceOf(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  return "UNKNOWN";
}

function repositoryOf(pkg) {
  const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return typeof url === "string" && url.trim() !== "" ? url.replace(/^git\+/, "").trim() : "";
}

/** The licence-like files at the top of a package folder, sorted by name, each with its text. */
function licenceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf8") }));
}

/** One licence text, or every file's text under its file name when a package has several. */
function joinLicenceTexts(files) {
  if (files.length === 1) return files[0].text;
  return files.map((file) => `--- ${file.name} ---\n\n${file.text}`).join("\n\n");
}

/**
 * Finds a package the way npm lays out node_modules: in fromDir/node_modules, then in each parent up to root.
 * Returns the package folder, or null when it is not installed.
 */
function resolvePackage(root, fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The production dependency tree of root: root package.json's dependencies, then their dependencies and the
 * optional ones that are installed. Each name@version appears once. Packages in NOT_SHIPPED are left out.
 */
export function collectPackages(root) {
  const rootPkg = readJson(path.join(root, "package.json"));
  const seen = new Set();
  const packages = [];
  // Each queued item is a dependency name and the folder it is resolved from.
  const queue = Object.keys(rootPkg.dependencies ?? {}).map((name) => ({ name, from: root, required: true }));
  for (const optional of Object.keys(rootPkg.optionalDependencies ?? {})) {
    queue.push({ name: optional, from: root, required: false });
  }

  while (queue.length > 0) {
    const { name, from, required } = queue.shift();
    if (isNotShipped(name)) continue;
    const dir = resolvePackage(root, from, name);
    if (dir === null) {
      if (required) throw new Error(`notices: ${name} is a dependency but is not installed (needed from ${path.relative(root, from) || "."}).`);
      continue;
    }
    const pkg = readJson(path.join(dir, "package.json"));
    const version = typeof pkg.version === "string" ? pkg.version : "";
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const files = licenceFiles(dir);
    packages.push({
      name,
      version,
      licence: licenceOf(pkg),
      repository: repositoryOf(pkg),
      licenceText: joinLicenceTexts(files),
    });
    for (const child of Object.keys(pkg.dependencies ?? {})) queue.push({ name: child, from: dir, required: true });
    for (const child of Object.keys(pkg.optionalDependencies ?? {})) queue.push({ name: child, from: dir, required: false });
  }
  return packages;
}

/**
 * The packages Next.js vendors in node_modules/next/dist/compiled (direct folders and @scope/child). A folder counts
 * when it has a licence-like file, since that is the notice the licence requires us to ship.
 */
export function collectVendored(root) {
  const compiled = path.join(root, "node_modules", "next", "dist", "compiled");
  if (!existsSync(compiled)) return [];

  const folders = [];
  for (const entry of readdirSync(compiled, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(compiled, entry.name);
    if (entry.name.startsWith("@")) {
      for (const child of readdirSync(dir, { withFileTypes: true })) {
        if (child.isDirectory()) folders.push({ folder: `${entry.name}/${child.name}`, dir: path.join(dir, child.name) });
      }
    } else {
      folders.push({ folder: entry.name, dir });
    }
  }

  const vendored = [];
  for (const { folder, dir } of folders) {
    const files = licenceFiles(dir);
    if (files.length === 0) continue;
    const pkg = existsSync(path.join(dir, "package.json")) ? readJson(path.join(dir, "package.json")) : {};
    vendored.push({
      name: `${folder} (bundled inside Next.js)`,
      version: typeof pkg.version === "string" ? pkg.version : "",
      licence: licenceOf(pkg),
      repository: repositoryOf(pkg),
      licenceText: joinLicenceTexts(files),
    });
  }
  return vendored;
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Everything the notices list, in order: extras first (as given), then packages and vendored entries sorted by name.
 * Each entry has name, version, licence, repository and licenceText ("" when the package has no licence file).
 */
export function allEntries({ packages, vendored, extras }) {
  const rest = [...packages, ...vendored].sort(byName);
  return [
    ...extras.map((extra) => ({ version: "", repository: "", licenceText: extra.text, ...extra })),
    ...rest,
  ];
}

/** The summary the About page reads: name, version and licence, sorted by name. */
export function summarize(entries) {
  return entries
    .map(({ name, version, licence }) => ({ name, version, licence }))
    .sort(byName);
}

/** The text of THIRD_PARTY_NOTICES.txt. */
export function renderNotices(input) {
  const header = [
    "THIRD-PARTY NOTICES",
    "",
    "MediaHub is released under the MIT licence (see LICENSE.txt in this folder).",
    "This file lists the open-source software that MediaHub ships with, its licence, and the licence text",
    "or notice that each package includes. The Node.js and WinSW entries are the programs that run MediaHub.",
    "",
  ];

  const sections = allEntries(input).map((entry) => {
    const title = `${entry.name}${entry.version ? ` ${entry.version}` : ""} — ${entry.licence}`;
    const lines = ["=".repeat(80), title];
    if (entry.repository) lines.push(`Repository: ${entry.repository}`);
    lines.push("");
    lines.push(
      entry.licenceText.trim() !== ""
        ? entry.licenceText.replace(/\s+$/, "")
        : `No licence file is included in this package. Licence: ${entry.licence}.`,
    );
    return `${lines.join("\n")}\n`;
  });

  return `${[...header, ...sections].join("\n")}`;
}

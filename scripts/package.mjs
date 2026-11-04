// Builds the self-contained package in dist/mediahub/. Run after `next build` (npm run package does both).
//
// The folder runs with only a node binary: `node --env-file=<config> mediahub.mjs`. It has no repo,
// no npm install and no dev tools. Copy it anywhere. Cross-platform: no shell commands, so it runs on Windows.
//
// Steps: copy .next/standalone (dereferencing symlinks and junctions, so the folder is relocatable),
// then public/, .next/static/ and drizzle/ (Next does not copy these), bundle the launcher and the
// break-glass tools with esbuild, write build-info.json, and refuse any .env* file or data/ folder.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const out = path.join(root, "dist", "mediahub");

function fail(message) {
  console.error(`package: ${message}`);
  process.exit(1);
}

/** Returns the paths of any .env* files or data/ folders under dir. Symlinks are not followed. */
function findForbidden(dir, rel = "", found = []) {
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const entryRel = path.join(rel, entry.name);
    if (entry.name.startsWith(".env")) found.push(entryRel);
    if (entry.name === "data" && rel === "") found.push(entryRel);
    if (entry.isDirectory()) findForbidden(dir, entryRel, found);
  }
  return found;
}

const nodeLine = readFileSync(path.join(root, ".node-version"), "utf8").trim();
const nodeTarget = `node${nodeLine.split(".")[0]}`;

if (!existsSync(path.join(standalone, "server.js"))) {
  fail("no .next/standalone/server.js. Run `npm run build` first (or `npm run package`).");
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// A data/ folder (the DB and image cache) or a .env* file must never ship. Next's file tracing once pulled
// data/image-cache into standalone output (fixed with turbopackIgnore in src/server/image-cache.ts): a traced
// data/ now fails the build. Next may copy .env* files, so those are skipped. The finished folder is checked below.
const skipped = [];
function keepFile(src) {
  const rel = path.relative(standalone, src);
  // A traced data/ folder means a server file builds a path into it that tracing follows. Fix that at the
  // source (see src/server/image-cache.ts) rather than packaging around it.
  if (rel === "data") fail("Next's file tracing copied data/ into .next/standalone. Add turbopackIgnore at the source.");
  const isEnvFile = path.basename(src).startsWith(".env");
  if (isEnvFile) skipped.push(rel);
  return !isEnvFile;
}

// dereference: true copies the target of each symlink or junction, so the folder has no absolute links.
const copyOptions = { recursive: true, dereference: true };
cpSync(standalone, out, { ...copyOptions, filter: keepFile });
if (skipped.length > 0) console.log(`Left out of the standalone copy: ${skipped.join(", ")}.`);
cpSync(path.join(root, "public"), path.join(out, "public"), copyOptions);
cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), copyOptions);
cpSync(path.join(root, "drizzle"), path.join(out, "drizzle"), copyOptions);

// The launcher and the tools run in plain Node, so they get the same conditions as the old tsx scripts:
// react-server makes server-only resolve to its empty module. better-sqlite3 is native, so it stays
// external and is loaded from the copied node_modules.
const bundleOptions = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: nodeTarget,
  conditions: ["react-server"],
  external: ["better-sqlite3"],
  // ESM output has no require(). Bundled CommonJS dependencies that call require("fs") etc. get a real one.
  banner: { js: 'import { createRequire as __mediahubCreateRequire } from "node:module"; const require = __mediahubCreateRequire(import.meta.url);' },
  logLevel: "warning",
};

const bundles = [
  ["scripts/launcher.ts", "mediahub.mjs"],
  ["scripts/create-user.ts", path.join("tools", "create-user.mjs")],
  ["scripts/reset-plex-admin.ts", path.join("tools", "reset-plex-admin.mjs")],
  ["scripts/migrate-tool.ts", path.join("tools", "migrate.mjs")],
  ["scripts/updater.ts", path.join("tools", "updater.mjs")],
];
mkdirSync(path.join(out, "tools"), { recursive: true });
for (const [entry, outfile] of bundles) {
  await build({ ...bundleOptions, entryPoints: [path.join(root, entry)], outfile: path.join(out, outfile) });
}

// The updater runs from a copy in the updates folder and must never load the database driver.
const updaterSource = readFileSync(path.join(out, "tools", "updater.mjs"), "utf8");
if (updaterSource.includes("better-sqlite3")) fail("tools/updater.mjs references better-sqlite3. It must not import the database.");

// The release workflow passes the installer's version (X.Y.Z, X.Y.Z-rc.N or X.Y.Z-dev.N), which the updater and the
// Settings page read from build-info.json. Its X.Y.Z must match package.json. Without --version, package.json's.
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const { values: args } = parseArgs({ options: { version: { type: "string" } } });
const version = args.version ?? pkg.version;
const versionMatch = /^(\d+\.\d+\.\d+)(?:-(?:rc|dev)\.\d+)?$/.exec(version);
if (!versionMatch || versionMatch[1] !== pkg.version) {
  fail(`--version must be ${pkg.version}, ${pkg.version}-rc.N or ${pkg.version}-dev.N.`);
}
writeFileSync(
  path.join(out, "build-info.json"),
  `${JSON.stringify({ version, node: process.version }, null, 2)}\n`,
);

// The bundles load better-sqlite3 from here at runtime. Tracing has to have copied it, native binary included.
const sqliteDir = path.join(out, "node_modules", "better-sqlite3");
if (!existsSync(path.join(sqliteDir, "package.json"))) {
  fail("node_modules/better-sqlite3 is missing from the standalone output.");
}

const leaked = findForbidden(out);
if (leaked.length > 0) {
  fail(`refusing to package: dist/mediahub contains ${leaked.join(", ")}.`);
}

console.log(`Packaged to ${path.relative(root, out)}/ (${readdirSync(out).length} top-level entries).`);

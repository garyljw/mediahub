import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import pkg from "../../package.json";
import { isValidVersion } from "@/server/updater/version";

let cached: string | null = null;

/**
 * The running MediaHub version. In the package it comes from build-info.json, which carries the installer's full
 * version (with any -rc.N), the same file the updater reads. The standalone server.js runs with its own folder as
 * the working directory, which is where build-info.json is. Elsewhere (npm run dev, tests) there is no such file,
 * so package.json's version is used.
 */
export function appVersion(): string {
  if (cached !== null) return cached;
  cached = pkg.version;
  try {
    // turbopackIgnore stops Next's file tracing from treating this as a file the build needs.
    const info: unknown = JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "build-info.json"), "utf8"));
    if (typeof info === "object" && info !== null && "version" in info && typeof info.version === "string" && isValidVersion(info.version)) {
      cached = info.version;
    }
  } catch {
    // No build-info.json: not the package.
  }
  return cached;
}

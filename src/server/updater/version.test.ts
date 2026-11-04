import "server-only";
import { describe, expect, it } from "vitest";
import { compareVersions, isPrerelease, isValidVersion } from "./version";

describe("compareVersions", () => {
  it("orders numeric parts as numbers", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("sorts a pre-release below its release", () => {
    expect(compareVersions("1.0.0-rc.2", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.2")).toBeGreaterThan(0);
  });

  it("sorts dev below rc and compares rc numbers", () => {
    expect(compareVersions("1.0.0-dev.9", "1.0.0-rc.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0-rc.10", "1.0.0-rc.9")).toBeGreaterThan(0);
  });

  it("throws on a value that is not a version", () => {
    expect(() => compareVersions("1.0", "1.0.0")).toThrow();
  });
});

describe("version helpers", () => {
  it("accepts only X.Y.Z with an optional -rc.N or -dev.N", () => {
    expect(isValidVersion("1.2.3")).toBe(true);
    expect(isValidVersion("1.2.3-rc.1")).toBe(true);
    expect(isValidVersion("1.2.3-beta.1")).toBe(false);
    expect(isValidVersion("v1.2.3")).toBe(false);
  });

  it("flags pre-releases", () => {
    expect(isPrerelease("1.2.3-rc.1")).toBe(true);
    expect(isPrerelease("1.2.3-dev.4")).toBe(true);
    expect(isPrerelease("1.2.3")).toBe(false);
  });
});

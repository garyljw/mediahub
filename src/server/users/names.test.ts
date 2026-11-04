import "server-only";
import { describe, expect, it } from "vitest";
import { isValidSignInName, normalizeName } from "./names";

describe("normalizeName", () => {
  it("trims, collapses inner whitespace and lowercases", () => {
    expect(normalizeName("  Amy   Pond  ")).toBe("amy pond");
    expect(normalizeName("amy\tpond")).toBe("amy pond");
    expect(normalizeName("AMY POND")).toBe("amy pond");
  });

  it("maps names that differ only in case or spacing to the same value", () => {
    expect(normalizeName("Amy  Pond")).toBe(normalizeName(" amy pond"));
  });
});

describe("isValidSignInName", () => {
  it("accepts a name with letters and spaces", () => {
    expect(isValidSignInName("Amy Pond")).toBe(true);
  });

  it("refuses an empty or blank name", () => {
    expect(isValidSignInName("")).toBe(false);
    expect(isValidSignInName("   ")).toBe(false);
  });

  it("refuses a name containing @", () => {
    expect(isValidSignInName("amy@example.test")).toBe(false);
    expect(isValidSignInName("Amy @ Home")).toBe(false);
  });
});

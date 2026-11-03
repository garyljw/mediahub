import { describe, expect, it } from "vitest";
import { normalizeTerm, resultLabel } from "./add";

describe("normalizeTerm", () => {
  it("trims the term", () => {
    expect(normalizeTerm("  Lantern Harbour  ")).toBe("Lantern Harbour");
  });

  it("returns null for an empty or whitespace-only term", () => {
    expect(normalizeTerm("")).toBeNull();
    expect(normalizeTerm("   ")).toBeNull();
  });

  it("caps the term at 100 characters", () => {
    expect(normalizeTerm("x".repeat(150))).toHaveLength(100);
  });
});

describe("labels", () => {
  it("shows the year in brackets when known", () => {
    expect(resultLabel({ title: "Lantern Harbour", year: 2021 })).toBe("Lantern Harbour (2021)");
    expect(resultLabel({ title: "Lantern Harbour", year: null })).toBe("Lantern Harbour");
  });
});

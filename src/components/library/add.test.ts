import { describe, expect, it } from "vitest";
import { addedMessage, folderLabel, normalizeTerm, resultLabel } from "./add";

const folders = [
  { id: 7, path: "/invented/movies/", freeSpace: 1288490188 },
  { id: 8, path: "/invented/other/", freeSpace: null },
];

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

describe("labels and messages", () => {
  it("shows the year in brackets when known", () => {
    expect(resultLabel({ title: "Lantern Harbour", year: 2021 })).toBe("Lantern Harbour (2021)");
    expect(resultLabel({ title: "Lantern Harbour", year: null })).toBe("Lantern Harbour");
  });

  it("builds the status line after an add", () => {
    expect(addedMessage({ title: "Lantern Harbour", year: 2021 })).toBe("Added Lantern Harbour (2021).");
    expect(addedMessage({ title: "Lantern Harbour", year: null })).toBe("Added Lantern Harbour.");
  });
});

describe("folderLabel", () => {
  it("adds the free space when Arr reported some", () => {
    expect(folderLabel(folders[0])).toBe("/invented/movies/ (1.2 GB free)");
  });

  it("shows only the path when free space is unknown or zero", () => {
    expect(folderLabel(folders[1])).toBe("/invented/other/");
    expect(folderLabel({ id: 9, path: "/invented/full/", freeSpace: 0 })).toBe("/invented/full/");
  });
});

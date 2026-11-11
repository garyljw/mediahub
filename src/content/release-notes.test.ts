import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { RELEASE_NOTES } from "./release-notes";

const parts = (version: string) => version.split(".").map(Number);

function compare(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

describe("RELEASE_NOTES", () => {
  it("starts with the version in package.json, so a release PR can't forget its notes", () => {
    // A test build (1.5.0-rc.1) is listed under the release it leads to (1.5.0).
    expect(RELEASE_NOTES[0].version).toBe(pkg.version.replace(/-rc\.\d+$/, ""));
  });

  it("uses only **bold**: every ** is closed, and no other Markdown or HTML", () => {
    const texts = RELEASE_NOTES.flatMap((release) =>
      release.sections.flatMap((section) => section.notes.flatMap((note) => [note.text, ...(note.details ?? [])])),
    );
    for (const text of texts) {
      expect(text.split("**").length % 2, text).toBe(1);
      expect(text, text).not.toMatch(/`|<|\]\(|\*\*\*\*/);
    }
  });

  it("is newest first, with valid dates that never go up the list", () => {
    for (const { version, date } of RELEASE_NOTES) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(date);
    }
    for (let i = 1; i < RELEASE_NOTES.length; i++) {
      expect(compare(RELEASE_NOTES[i - 1].version, RELEASE_NOTES[i].version)).toBeGreaterThan(0);
      expect(RELEASE_NOTES[i - 1].date >= RELEASE_NOTES[i].date).toBe(true);
    }
  });

  it("gives every release at least one note", () => {
    for (const release of RELEASE_NOTES) {
      expect(release.sections.length, release.version).toBeGreaterThan(0);
      for (const section of release.sections) expect(section.notes.length, release.version).toBeGreaterThan(0);
    }
  });
});

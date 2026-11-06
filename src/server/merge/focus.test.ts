import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFocusOrder } from "./focus";

type Case = { name: string; current: number[]; ordered: number[]; expected: number[] | null };
const cases: Case[] = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "focus-order.json"), "utf8"));

describe("applyFocusOrder", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(applyFocusOrder(c.current, c.ordered)).toEqual(c.expected);
  });

  it("returns a new array, not the input", () => {
    const ordered = [2, 1];
    const result = applyFocusOrder([1, 2], ordered);
    expect(result).not.toBe(ordered);
  });
});

import "server-only";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UPDATE_PUBLIC_KEY_PEM } from "./public-key";

describe("UPDATE_PUBLIC_KEY_PEM", () => {
  it("matches installer/update-public-key.pem", () => {
    const file = fileURLToPath(new URL("../../../installer/update-public-key.pem", import.meta.url));
    expect(UPDATE_PUBLIC_KEY_PEM).toBe(readFileSync(file, "utf8"));
  });
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src/", import.meta.url));
const serverOnlyStub = fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: src },
      { find: /^server-only$/, replacement: serverOnlyStub },
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});

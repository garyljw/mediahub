import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Local rules that enforce the CLAUDE.md security rules mechanically, so
// reviews don't have to keep re-checking them.
const mediahub = {
  rules: {
    // CLAUDE.md rule 1: every file under src/server/ starts with import "server-only".
    "server-only-first": {
      meta: {
        type: "problem",
        messages: {
          missing: 'Files in src/server/ must start with `import "server-only";`.',
        },
        schema: [],
      },
      create(context) {
        return {
          Program(node) {
            const first = node.body[0];
            const ok =
              first?.type === "ImportDeclaration" &&
              first.source.value === "server-only" &&
              first.specifiers.length === 0;
            if (!ok) context.report({ node: first ?? node, messageId: "missing" });
          },
        };
      },
    },
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { mediahub },
  },
  {
    files: ["src/server/**/*.{ts,tsx}"],
    rules: { "mediahub/server-only-first": "error" },
  },
  // CLAUDE.md rule 2: config is read only via env() from src/server/env.ts.
  {
    ignores: ["src/server/env.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read config via env() from src/server/env.ts (CLAUDE.md rule 2).",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated from openapi/*.json by scripts/gen-arr.mjs.
    "src/server/arr/generated/**",
  ]),
]);

export default eslintConfig;

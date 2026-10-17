// Generates TypeScript types for the Radarr and Sonarr APIs from the pinned
// OpenAPI specs in openapi/. Output is deterministic: rerunning produces no diff.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  {
    name: "Radarr",
    release: "v6.4.4.10685",
    spec: path.join(root, "openapi", "radarr.json"),
    out: path.join(root, "src", "server", "arr", "generated", "radarr.ts"),
  },
  {
    name: "Sonarr",
    release: "v4.0.20.3014",
    spec: path.join(root, "openapi", "sonarr.json"),
    out: path.join(root, "src", "server", "arr", "generated", "sonarr.ts"),
  },
];

for (const t of targets) {
  const ast = await openapiTS(pathToFileURL(t.spec));
  const types = astToString(ast);
  const header = [
    `import "server-only";`,
    ``,
    `// GENERATED FILE. Do not edit by hand.`,
    `// Source: openapi/${path.basename(t.spec)} (${t.name} ${t.release}).`,
    `// Regenerate with: npm run gen:arr`,
    ``,
  ].join("\n");
  await mkdir(path.dirname(t.out), { recursive: true });
  await writeFile(t.out, `${header}\n${types}`);
  console.log(`wrote ${path.relative(root, t.out)} (${t.name} ${t.release})`);
}

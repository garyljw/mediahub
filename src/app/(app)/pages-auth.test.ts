import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Guard: every page under (app) must do its own server-side role check, as the first statement
// of its default export. The layout check is UX only, because layouts don't re-render on client
// navigation. "First" matters: with partial prefetching, anything rendered before the first
// request-time API can end up in a static shell shared between users.
const APP_DIR = join(__dirname);

function findPageFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === "page.tsx")
    .map((entry) => join(entry.parentPath, entry.name));
}

/** The literal roles passed to `await requirePageUser(...)`, or null if node is not that call. */
function requirePageUserRoles(node: ts.Node | undefined): string[] | null {
  if (
    node === undefined ||
    !ts.isAwaitExpression(node) ||
    !ts.isCallExpression(node.expression) ||
    !ts.isIdentifier(node.expression.expression) ||
    node.expression.expression.text !== "requirePageUser"
  ) {
    return null;
  }
  // Roles must be string literals, so this test can check them against PAGE_ROLES.
  const args = node.expression.arguments;
  const literals = args.filter(ts.isStringLiteral);
  return literals.length === args.length ? literals.map((arg) => arg.text) : null;
}

/** True when the file has `import { requirePageUser } from "@/server/authz"`, unaliased, so the name is the real check. */
function importsRealCheck(file: ts.SourceFile): boolean {
  return file.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === "@/server/authz" &&
      !s.importClause?.isTypeOnly &&
      s.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some(
        (el) => el.name.text === "requirePageUser" && !el.propertyName && !el.isTypeOnly,
      ),
  );
}

/**
 * The roles a page allows, when its default export's first statement is `await requirePageUser(...)`
 * (bare or assigned to a const) and requirePageUser is imported from @/server/authz. Otherwise null.
 */
function pageCheckRoles(source: string): string[] | null {
  const file = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (!importsRealCheck(file)) return null;
  const page = file.statements.find(
    (s): s is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(s) &&
      (ts.getCombinedModifierFlags(s) & ts.ModifierFlags.ExportDefault) === ts.ModifierFlags.ExportDefault,
  );
  const first = page?.body?.statements[0];
  if (!first) return null;
  if (ts.isExpressionStatement(first)) return requirePageUserRoles(first.expression);
  if (ts.isVariableStatement(first)) {
    const [decl, ...rest] = first.declarationList.declarations;
    return rest.length === 0 ? requirePageUserRoles(decl?.initializer) : null;
  }
  return null;
}

function startsWithPageCheck(source: string): boolean {
  return pageCheckRoles(source) !== null;
}

// The role policy for every page. A new page must be added here, so its roles are a deliberate choice.
const BOTH = ["admin", "requester"];
const PAGE_ROLES: Record<string, string[]> = {
  "page.tsx": BOTH,
  "add/page.tsx": BOTH,
  "movies/page.tsx": BOTH,
  "tv/page.tsx": BOTH,
  "tv/[id]/page.tsx": BOTH,
  "focus/movies/page.tsx": BOTH,
  "focus/tv/page.tsx": BOTH,
  "movies/[id]/page.tsx": BOTH,
  "calendar/page.tsx": BOTH,
  "queue/page.tsx": BOTH,
  "history/page.tsx": BOTH,
  "settings/page.tsx": ["admin"],
  "settings/connections/page.tsx": ["admin"],
  "settings/add-defaults/page.tsx": ["admin"],
  "settings/users/page.tsx": ["admin"],
  "settings/updates/page.tsx": ["admin"],
};

describe("(app) pages", () => {
  const pages = findPageFiles(APP_DIR).map((page) => page.slice(APP_DIR.length + 1));

  it("finds the expected pages, so the checks below cannot pass vacuously", () => {
    expect(pages.length).toBeGreaterThanOrEqual(7);
  });

  it.each(pages.map((page) => [page]))("%s starts with await requirePageUser( and allows exactly its PAGE_ROLES", (page) => {
    const roles = pageCheckRoles(readFileSync(join(APP_DIR, page), "utf8"));
    expect(roles, "missing or invalid requirePageUser check").not.toBeNull();
    expect(PAGE_ROLES[page], `add ${page} to PAGE_ROLES`).toBeDefined();
    expect([...roles!].sort()).toEqual([...PAGE_ROLES[page]].sort());
  });

  it("has no PAGE_ROLES entry for a page that no longer exists", () => {
    expect(Object.keys(PAGE_ROLES).sort()).toEqual([...pages].sort());
  });
});

describe("startsWithPageCheck", () => {
  const real = `import { requirePageUser } from "@/server/authz";\n`;

  it("accepts a bare or assigned await as the first statement", () => {
    expect(startsWithPageCheck(real + `export default async function P() { await requirePageUser("admin"); return null; }`)).toBe(true);
    expect(startsWithPageCheck(real + `export default async function P() { const u = await requirePageUser("admin"); return u; }`)).toBe(true);
  });

  it("rejects a check that is commented out, not awaited, late or missing", () => {
    expect(startsWithPageCheck(real + `export default async function P() { // requirePageUser("admin")\n return null; }`)).toBe(false);
    expect(startsWithPageCheck(real + `export default async function P() { requirePageUser("admin"); return null; }`)).toBe(false);
    expect(startsWithPageCheck(real + `export default async function P() { const d = await load(); await requirePageUser("admin"); return d; }`)).toBe(false);
    expect(startsWithPageCheck(real + `export default async function P() { return null; }`)).toBe(false);
    expect(startsWithPageCheck(real + `export async function P() { await requirePageUser("admin"); }`)).toBe(false);
  });

  it("rejects a requirePageUser that is not the real one", () => {
    const body = `export default async function P() { await requirePageUser("admin"); return null; }`;
    expect(startsWithPageCheck(body)).toBe(false);
    expect(startsWithPageCheck(`import { requirePageUser } from "@/lib/stub";\n` + body)).toBe(false);
    expect(startsWithPageCheck(`import { getSession as requirePageUser } from "@/server/authz";\n` + body)).toBe(false);
    expect(startsWithPageCheck(`async function requirePageUser(..._: string[]) {}\n` + body)).toBe(false);
  });

  it("returns the literal roles, and null for roles it cannot read", () => {
    expect(pageCheckRoles(real + `export default async function P() { await requirePageUser("admin", "requester"); }`)).toEqual(["admin", "requester"]);
    expect(pageCheckRoles(real + `export default async function P() { await requirePageUser(...ALL); }`)).toBeNull();
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Guard: every server action in src/ must start with its own role check. A "use server" file
// is reachable by a plain POST, so the check must run before anything else in the action. The check
// is either a bare `await requireRole(...)`, or a `try` whose first statement is that call and whose
// catch returns or throws (so a denial is returned, not swallowed). Same approach as pages-auth.test.ts.
// Scans all of src/, not just src/app: a "use server" file anywhere is reachable by POST.
const SRC_DIR = join(__dirname, "..");

// Actions allowed to run without a role check, as "<file>#<export>" relative to src/.
const PUBLIC_ACTIONS = new Set([
  // Sign-out needs only the session cookie, and it can't do harm: it only clears the caller's own session.
  "app/(app)/actions.ts#signOut",
]);

type Action = { name: string; statements: readonly ts.Statement[] | undefined };

function parse(source: string, fileName: string): ts.SourceFile {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

/** The statements of a function-valued expression with a block body, or undefined for anything else. */
function functionStatements(node: ts.Expression | undefined): readonly ts.Statement[] | undefined {
  if (node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isBlock(node.body)) {
    return node.body.statements;
  }
  return undefined;
}

/** True when `requireRole` is imported from @/server/authz by its own name (not aliased, not type-only). */
function importsRequireRole(file: ts.SourceFile): boolean {
  return file.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === "@/server/authz" &&
      !s.importClause?.isTypeOnly &&
      s.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some(
        (el) => el.name.text === "requireRole" && !el.propertyName && !el.isTypeOnly,
      ),
  );
}

/** Every runtime export of a file, with the statements of its body. Re-exports and `export *` have no body to check. */
function exportedActions(file: ts.SourceFile): Action[] {
  // Top-level functions by local name, so `export { local }` can be followed to its body.
  const localFunctions = new Map<string, readonly ts.Statement[] | undefined>();
  for (const s of file.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) localFunctions.set(s.name.text, s.body?.statements);
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) localFunctions.set(d.name.text, functionStatements(d.initializer));
      }
    }
  }

  const actions: Action[] = [];
  for (const s of file.statements) {
    if (ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
      actions.push({ name: s.name?.text ?? "default", statements: s.body?.statements });
    } else if (ts.isVariableStatement(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
      // A non-function export (e.g. a constant) has no statements, so it is reported as unchecked.
      for (const d of s.declarationList.declarations) {
        actions.push({ name: d.name.getText(file), statements: functionStatements(d.initializer) });
      }
    } else if (ts.isExportDeclaration(s) && !s.isTypeOnly) {
      if (s.exportClause && ts.isNamedExports(s.exportClause)) {
        for (const el of s.exportClause.elements) {
          if (el.isTypeOnly) continue;
          const local = el.propertyName ?? el.name;
          const statements = s.moduleSpecifier ? undefined : localFunctions.get(local.text);
          actions.push({ name: el.name.text, statements });
        }
      } else {
        // `export * from` and `export * as ns from` hide their names from this check.
        actions.push({ name: "export *", statements: undefined });
      }
    } else if (ts.isExportAssignment(s) && !s.isExportEquals) {
      const statements = ts.isIdentifier(s.expression)
        ? localFunctions.get(s.expression.text)
        : functionStatements(s.expression);
      actions.push({ name: "default", statements });
    }
  }
  return actions;
}

/** True when a statement is `await requireRole(...)`, bare or assigned, with literal role names. */
function isRoleCheck(node: ts.Expression | undefined): boolean {
  if (!node || !ts.isAwaitExpression(node) || !ts.isCallExpression(node.expression)) return false;
  const call = node.expression;
  return (
    ts.isIdentifier(call.expression) &&
    call.expression.text === "requireRole" &&
    call.arguments.length > 0 &&
    call.arguments.every(ts.isStringLiteral)
  );
}

function isRoleCheckStatement(stmt: ts.Statement | undefined): boolean {
  if (!stmt) return false;
  if (ts.isExpressionStatement(stmt)) return isRoleCheck(stmt.expression);
  if (ts.isVariableStatement(stmt)) {
    const decls = stmt.declarationList.declarations;
    return decls.length === 1 && isRoleCheck(decls[0]?.initializer);
  }
  return false;
}

/** The catch must end by returning or throwing, so a failed check can never fall through into the action. */
function catchExits(block: ts.Block): boolean {
  const last = block.statements.at(-1);
  return last !== undefined && (ts.isReturnStatement(last) || ts.isThrowStatement(last));
}

/** True when the action's first statement is a passing role check, in one of the two accepted shapes. */
function startsWithRoleCheck(statements: readonly ts.Statement[] | undefined): boolean {
  const first = statements?.[0];
  if (!first) return false;
  if (ts.isTryStatement(first)) {
    return (
      isRoleCheckStatement(first.tryBlock.statements[0]) &&
      first.catchClause !== undefined &&
      catchExits(first.catchClause.block) &&
      // A finally block runs even after a denial, so it's not allowed on the check.
      first.finallyBlock === undefined
    );
  }
  return isRoleCheckStatement(first);
}

/** True for a function whose body starts with "use server", i.e. an inline server action. */
function isInlineAction(node: ts.Node): boolean {
  if (!ts.isFunctionLike(node)) return false;
  const body = (node as ts.FunctionLikeDeclaration).body;
  const first = body && ts.isBlock(body) ? body.statements[0] : undefined;
  return first !== undefined && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
}

/** Inline server actions are banned outright: they're harder to see in review and this guard doesn't check their role. */
function inlineActionViolations(file: ts.SourceFile, relPath: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (isInlineAction(node)) found.push(`${relPath}: inline "use server" function`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The actions in one file, and those that fail the check and are not allowlisted. Files without "use server" have none. */
function inspect(relPath: string, source: string): { actions: string[]; violations: string[] } {
  const file = parse(source, relPath);
  const inline = inlineActionViolations(file, relPath);
  const first = file.statements[0];
  const isServerFile =
    first !== undefined && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
  if (!isServerFile) return { actions: [], violations: inline };

  const imported = importsRequireRole(file);
  const found = exportedActions(file);
  const ids = found.map((a) => `${relPath}#${a.name}`);
  const failing = found
    .filter((a) => !imported || !startsWithRoleCheck(a.statements))
    .map((a) => `${relPath}#${a.name}`)
    .filter((id) => !PUBLIC_ACTIONS.has(id));
  return { actions: ids, violations: [...inline, ...failing] };
}

function findSourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const results = findSourceFiles(SRC_DIR)
  .filter((file) => !file.startsWith(join(SRC_DIR, "server", "arr", "generated") + sep))
  .map((file) => {
    const rel = relative(SRC_DIR, file).split(sep).join("/");
    return inspect(rel, readFileSync(file, "utf8"));
  });

describe("server actions in src/", () => {
  it("finds the expected actions, so the checks below cannot pass vacuously", () => {
    const actions = results.flatMap((r) => r.actions);
    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(actions).toContain("app/(app)/movies/actions.ts#updateMovies");
    expect(actions).toContain("app/(app)/movies/actions.ts#removeMovies");
    expect(actions).toContain("app/(app)/tv/actions.ts#updateSeries");
    expect(actions).toContain("app/(app)/tv/actions.ts#removeSeries");
    expect(actions).toContain("app/(app)/tv/[id]/actions.ts#setSeasonMonitoring");
    expect(actions).toContain("app/(app)/tv/[id]/actions.ts#setEpisodeMonitoring");
    expect(actions).toContain("app/(app)/tv/[id]/actions.ts#deleteSeriesItem");
    expect(actions).toContain("app/(app)/movies/[id]/actions.ts#deleteMovie");
    expect(actions).toContain("app/(app)/actions.ts#signOut");
  });

  it("every action starts with await requireRole(...), or is in PUBLIC_ACTIONS", () => {
    expect(results.flatMap((r) => r.violations)).toEqual([]);
  });

  it("allowlists only the sign-out action, and each entry is a real action", () => {
    expect([...PUBLIC_ACTIONS]).toEqual(["app/(app)/actions.ts#signOut"]);
    const actions = results.flatMap((r) => r.actions);
    for (const id of PUBLIC_ACTIONS) expect(actions).toContain(id);
  });
});

describe("the action checker", () => {
  const imp = `import { requireRole, AuthzError } from "@/server/authz";\n`;
  const server = `"use server";\n${imp}`;
  const violationsOf = (source: string, relPath = "app/(app)/fixture.ts") => inspect(relPath, source).violations;

  it("accepts a try-wrapped check first, when the catch returns", () => {
    const src =
      server +
      `export async function act() { try { await requireRole("admin"); } catch (e) { if (e instanceof AuthzError) return { ok: false }; throw e; } return { ok: true }; }`;
    expect(violationsOf(src)).toEqual([]);
  });

  it("accepts a bare check first, and an assigned one", () => {
    expect(violationsOf(server + `export async function act() { await requireRole("admin"); return 1; }`)).toEqual([]);
    expect(violationsOf(server + `export async function act() { const { user } = await requireRole("admin", "requester"); return user; }`)).toEqual([]);
  });

  it("flags a missing check", () => {
    expect(violationsOf(server + `export async function act() { return 1; }`)).toEqual(["app/(app)/fixture.ts#act"]);
  });

  it("flags a check that is not the first statement", () => {
    expect(violationsOf(server + `export async function act() { const d = await load(); await requireRole("admin"); return d; }`)).toEqual([
      "app/(app)/fixture.ts#act",
    ]);
  });

  it("flags a check that is not awaited", () => {
    expect(violationsOf(server + `export async function act() { requireRole("admin"); return 1; }`)).toEqual(["app/(app)/fixture.ts#act"]);
  });

  it("flags a try whose catch swallows the denial and falls through", () => {
    const src =
      server +
      `export async function act() { try { await requireRole("admin"); } catch (e) { console.error(e); } return 1; }`;
    expect(violationsOf(src)).toEqual(["app/(app)/fixture.ts#act"]);
  });

  it("flags an aliased requireRole import, and a requireRole from another module", () => {
    expect(
      violationsOf(
        `"use server";\nimport { requireRole as check } from "@/server/authz";\nexport async function act() { await check("admin"); return 1; }`,
      ),
    ).toEqual(["app/(app)/fixture.ts#act"]);
    expect(
      violationsOf(
        `"use server";\nimport { requireRole } from "@/lib/stub";\nexport async function act() { await requireRole("admin"); return 1; }`,
      ),
    ).toEqual(["app/(app)/fixture.ts#act"]);
  });

  it("flags an exported value that is not a checked function", () => {
    expect(violationsOf(server + `export const LIMIT = 5;`)).toEqual(["app/(app)/fixture.ts#LIMIT"]);
  });

  it("follows export { name } to the local function, checking its body", () => {
    expect(violationsOf(server + `async function act() { return 1; }\nexport { act };`)).toEqual(["app/(app)/fixture.ts#act"]);
    expect(
      violationsOf(server + `async function act() { await requireRole("admin"); return 1; }\nexport { act };`),
    ).toEqual([]);
  });

  it("flags re-exports, since their bodies are not in this file", () => {
    expect(violationsOf(server + `export { act } from "./other";`)).toEqual(["app/(app)/fixture.ts#act"]);
    expect(violationsOf(server + `export * from "./other";`)).toEqual(["app/(app)/fixture.ts#export *"]);
  });

  it("ignores type-only exports and files without the use server directive", () => {
    expect(inspect("app/(app)/fixture.ts", server + `export type T = string;`)).toEqual({ actions: [], violations: [] });
    expect(inspect("app/(app)/fixture.ts", `${imp}export async function act() { return 1; }`)).toEqual({ actions: [], violations: [] });
  });

  it("allowlists sign-out only in its own file", () => {
    const signOut = server + `export async function signOut() { await getAuth().api.signOut({}); }`;
    expect(violationsOf(signOut, "app/(app)/actions.ts")).toEqual([]);
    expect(violationsOf(signOut, "app/(app)/other.ts")).toEqual(["app/(app)/other.ts#signOut"]);
  });

  it("rejects an inline \"use server\" function anywhere, even in a file that isn't a server file", () => {
    const page = `export default function Page() { async function act() { "use server"; } return act; }`;
    expect(violationsOf(page, "app/(app)/x/page.tsx")).toEqual(['app/(app)/x/page.tsx: inline "use server" function']);
  });

  it("checks server files outside src/app too", () => {
    expect(violationsOf(`"use server";\nexport async function act() { return 1; }`, "components/movies/actions.ts")).toEqual([
      "components/movies/actions.ts#act",
    ]);
  });

  it("rejects a try-wrapped check with a finally block, which would run after a denial", () => {
    const src =
      server +
      `export async function act() { try { await requireRole("admin"); } catch (e) { return { ok: false }; } finally { await work(); } }`;
    expect(violationsOf(src)).toEqual(["app/(app)/fixture.ts#act"]);
  });
});

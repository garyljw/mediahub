// Builds the value Better Auth puts in its session cookie: the token, a dot, and an HMAC-SHA256 of the token with the
// auth secret (base64), then URL-encoded. This matches better-call's signCookieValue (node_modules/better-call), which
// the test checks it against. Pure, so the seed and the tests can both import it without the server modules.
import { createHmac } from "node:crypto";
import path from "node:path";

export function signedSessionCookieValue(token: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

/**
 * Why a DATABASE_PATH is not allowed for the demo seed, or null when it is a file inside <repoRoot>/demo/. The seed
 * deletes and rewrites its database, so this check keeps it away from data/ and every other file.
 */
export function demoDatabaseProblem(databasePath: string | undefined, repoRoot: string): string | null {
  if (!databasePath) return "DATABASE_PATH is not set.";
  const demoDir = path.resolve(repoRoot, "demo");
  const resolved = path.resolve(repoRoot, databasePath);
  const relative = path.relative(demoDir, resolved);
  const outside = relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (outside) return `DATABASE_PATH must point inside ${demoDir}.`;
  return null;
}

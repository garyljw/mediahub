// Break-glass: clears the Plex admin setup so /setup can run again, and signs out every admin.
// Use it when the Plex server or account has changed, or when the setup must be redone.
//
// Usage:
//   npm run reset-plex-admin
//
// It asks you to type RESET. Requester accounts and their sessions are not touched.
//
// Why --conditions=react-server (set in package.json): see scripts/create-user.ts.

import { createInterface } from "node:readline/promises";
import { getAuth } from "../src/server/auth";
import { clearPlexAdminConfig, getPlexAdminConfig } from "../src/server/plex/admin-config";

function fail(message: string): never {
  console.error(`reset-plex-admin: ${message}`);
  process.exit(1);
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "This clears the Plex admin setup and signs out every admin. Requesters are not affected.\nType RESET to continue: ",
  );
  rl.close();
  if (answer.trim() !== "RESET") fail("not confirmed. Nothing was changed.");

  const before = getPlexAdminConfig();
  clearPlexAdminConfig();

  const ctx = await getAuth().$context;
  const admins = await ctx.internalAdapter.listUsers(1000, 0, undefined, [{ field: "role", value: "admin" }]);
  for (const admin of admins) {
    await ctx.internalAdapter.deleteUserSessions(admin.id);
  }

  console.log(
    before
      ? `Cleared the Plex admin setup for server "${before.serverName}".`
      : "No Plex admin setup was stored.",
  );
  console.log(`Signed out ${admins.length} admin account(s). Open /setup to set Plex up again.`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : "unexpected error.");
});

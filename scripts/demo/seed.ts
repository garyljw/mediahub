// Seeds the demo database (npm run demo). Run by run.ts with --conditions=react-server, like the other scripts that
// load src/server (see package.json). It deletes demo/mediahub.db and builds it again, so running it twice is fine.
//
// It refuses to run unless DATABASE_PATH is a file inside <repo>/demo/. It writes demo/admin-session.json, which the
// screenshot script uses to sign in as the demo admin (the admin has no password, so this file is the only way in).
//
// Why the server modules are used directly: they are the same functions the Settings pages call, so the demo database
// has the same shape as a real one, and a schema or setting change breaks this script rather than the demo silently.
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAuth } from "../../src/server/auth";
import { db } from "../../src/server/db";
import { applyMigrations } from "../../src/server/db/migrate";
import { session as sessionTable } from "../../src/server/db/schema";
import { processEnvironment } from "../../src/server/env";
import { addToFocus } from "../../src/server/focus/focus";
import { claimPlexAdminConfig } from "../../src/server/plex/admin-config";
import { savePlexDataConnection } from "../../src/server/plex/data-connection";
import { saveConnection } from "../../src/server/settings/connections";
import { saveMovieAddDefaults, saveSeriesAddDefaults } from "../../src/server/settings/add-defaults";
import { createRequester } from "../../src/server/users";
import { buildCatalogue } from "./catalogue";
import {
  DEMO_ADMIN,
  DEMO_API_KEY,
  DEMO_PLEX_SERVER,
  DEMO_PLEX_TOKEN,
  DEMO_PORTS,
  DEMO_REQUESTER,
  SESSION_COOKIE_NAME,
} from "./config";
import { demoDatabaseProblem, signedSessionCookieValue } from "./session-cookie";

const SESSION_DAYS = 30;

function fail(message: string): never {
  console.error(`seed: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  // Read through processEnvironment(): src/server/env.ts is the one place allowed to read process.env.
  const env = processEnvironment();
  const problem = demoDatabaseProblem(env.DATABASE_PATH, repoRoot);
  if (problem) fail(`refusing to run. ${problem} The demo seed only writes inside demo/.`);
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) fail("BETTER_AUTH_SECRET is not set. npm run demo sets it.");

  const databaseFile = path.resolve(repoRoot, env.DATABASE_PATH ?? "");
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${databaseFile}${suffix}`, { force: true });
  // MediaHub caches posters next to the database by item id. A new catalogue reuses ids for different titles, so a
  // cache left from an earlier run would show the wrong posters. The path check above keeps this inside demo/.
  rmSync(path.join(path.dirname(databaseFile), "image-cache"), { recursive: true, force: true });
  mkdirSync(path.dirname(databaseFile), { recursive: true });
  applyMigrations("drizzle");

  // The Arr connections point at the fake servers on 127.0.0.1, with the demo key.
  saveConnection("radarr", { url: `http://127.0.0.1:${DEMO_PORTS.radarr}`, apiKey: DEMO_API_KEY });
  saveConnection("sonarr", { url: `http://127.0.0.1:${DEMO_PORTS.sonarr}`, apiKey: DEMO_API_KEY });

  // The Plex admin setup and the Plex data connection, both pointing at the fake Plex server.
  const claimed = claimPlexAdminConfig({
    serverId: DEMO_PLEX_SERVER.id,
    serverName: DEMO_PLEX_SERVER.name,
    ownerAccountId: DEMO_PLEX_SERVER.ownerAccountId,
  });
  if (!claimed) fail("the Plex admin configuration was already set. The database should have been deleted first.");
  savePlexDataConnection({
    url: `http://127.0.0.1:${DEMO_PORTS.plex}`,
    pinAddress: null,
    token: DEMO_PLEX_TOKEN,
    serverId: DEMO_PLEX_SERVER.id,
    serverName: DEMO_PLEX_SERVER.name,
  });

  const catalogue = buildCatalogue(Date.now());
  // The Add defaults point at the first profile and root folder in the demo, the ones the fakes report.
  const movieProfile = catalogue.radarr.profiles[0];
  const movieFolder = catalogue.radarr.rootFolders[0];
  const seriesProfile = catalogue.sonarr.profiles[0];
  const seriesFolder = catalogue.sonarr.rootFolders[0];
  if (!movieProfile || !movieFolder || !seriesProfile || !seriesFolder) fail("the demo catalogue has no profile or root folder.");
  saveMovieAddDefaults({ profileId: movieProfile.id ?? 1, rootFolderId: movieFolder.id ?? 1 });
  saveSeriesAddDefaults({ profileId: seriesProfile.id ?? 1, rootFolderId: seriesFolder.id ?? 1, monitor: "all" });

  // Users. The requester signs in with a password. The admin is created the way the Plex sign-in creates one (a plex
  // account row, no password), so the demo admin matches a real admin.
  const ctx = await getAuth().$context;
  const requester = await createRequester(ctx, DEMO_REQUESTER);
  if (!requester.ok) fail(`could not create the demo requester (${requester.reason}).`);

  const admin = await ctx.internalAdapter.createUser(
    { name: DEMO_ADMIN.name, email: DEMO_ADMIN.email, role: "admin", emailVerified: false },
    { method: "plex" },
  );
  await ctx.internalAdapter.createAccount({ userId: admin.id, providerId: "plex", accountId: DEMO_PLEX_SERVER.ownerAccountId });

  // A session row for the admin, with a random token. The cookie carries the token, signed with the auth secret.
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  db()
    .insert(sessionTable)
    .values({
      id: randomUUID(),
      token,
      userId: admin.id,
      expiresAt: new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: "demo-seed",
    })
    .run();

  const demoDir = path.resolve(repoRoot, "demo");
  writeFileSync(
    path.join(demoDir, "admin-session.json"),
    `${JSON.stringify({ name: SESSION_COOKIE_NAME, value: signedSessionCookieValue(token, secret) }, null, 2)}\n`,
  );

  // A few items in each Focus list, so the Home and Focus pages have something to show.
  for (const id of catalogue.focus.movieIds) addToFocus("movie", id, admin.id);
  for (const id of catalogue.focus.seriesIds) addToFocus("series", id, admin.id);

  console.log(
    `seed: demo database ready (${path.relative(repoRoot, databaseFile)}): 1 admin, 1 requester, ` +
      `${catalogue.radarr.movies.length} movies, ${catalogue.sonarr.series.length} series.`,
  );
}

main().catch((error: unknown) => {
  // Print only the message. Config errors list variable names, never values.
  fail(error instanceof Error ? error.message : "unexpected error.");
});

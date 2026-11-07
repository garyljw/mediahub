// npm run demo: starts a fake Radarr, Sonarr and Plex (one process, three ports), seeds demo/mediahub.db and then starts
// MediaHub's dev server against it, so screenshots can show the real UI with made-up data. Nothing here touches data/.
//
// Usage:
//   npm run demo               start the fakes, seed the demo database and run `next dev -p 3100`
//   npm run demo -- --no-next  start the fakes and seed only (for testing the fakes with curl)
//   npm run demo:screenshots   the same stack, then the screenshots in docs/screenshots/, then shut down (exit 0 or 1)
//
// Stop with Ctrl+C. Stop any running `npm run dev` first: both use the .next folder, so the second one can't start.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { artCacheDir } from "./art";
import { buildCatalogue } from "./catalogue";
import { DEAD_PROXY, DEMO_ADMIN, DEMO_AUTH_SECRET, DEMO_HOST, DEMO_PORTS, DEMO_REQUESTER } from "./config";
import { startFakeServers, type FakeServers } from "./fake-servers";

const NEXT_START_HINT = "Stop any running `npm run dev` first, then run `npm run demo` again.";
/** A `next dev` that dies within this many ms is almost always the folder lock, not a real error. */
const EARLY_EXIT_MS = 30_000;

const repoRoot = process.cwd();
const noNext = process.argv.includes("--no-next");
const screenshots = process.argv.includes("--screenshots");
/** How long a fresh `next dev` may take to answer on /login before the screenshots give up. */
const LOGIN_READY_MS = 3 * 60_000;

function run(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(command, args, { cwd: repoRoot, env, stdio: "inherit", shell: process.platform === "win32" });
}

/** Resolves with the exit code once the child has finished. */
function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    child.on("error", () => resolve(1));
  });
}

/** The environment the demo children run with: the parent's, plus the demo settings. Passed explicitly so they win over .env.local. */
function demoEnvironment(): NodeJS.ProcessEnv {
  // Child processes need the parent's PATH and HOME. This is a copy handed on, not configuration read by MediaHub.
  // eslint-disable-next-line no-restricted-properties
  const base: NodeJS.ProcessEnv = { ...process.env };
  return {
    ...base,
    DATABASE_PATH: path.join(repoRoot, "demo", "mediahub.db"),
    BETTER_AUTH_URL: `http://${DEMO_HOST}:${DEMO_PORTS.web}`,
    BETTER_AUTH_SECRET: DEMO_AUTH_SECRET,
    MEDIAHUB_PLEX_FOCUS_SYNC: "false",
    MEDIAHUB_AUTO_UPDATE: "false",
    DISPLAY_TIMEZONE: "Europe/London",
    // Keep the demo off the internet: Node sends every outside request to a dead proxy, so the Plex sign-in button,
    // TMDB/TVDB images and update checks fail instead of reaching real services. The local fakes are exempt.
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: DEAD_PROXY,
    HTTPS_PROXY: DEAD_PROXY,
    NO_PROXY: "127.0.0.1,localhost",
  };
}

/**
 * Serves one page on 127.0.0.1 that sets the seeded admin session cookie and sends the browser to the demo. Cookies
 * ignore the port, so a cookie set here is sent to the demo on the same host. Loopback only, and it hands out a
 * session for the throwaway demo database, nothing else.
 */
function startAdminHelper(): Promise<Server> {
  const sessionFile = path.join(repoRoot, "demo", "admin-session.json");
  const server = createServer((_request, response) => {
    const cookie = JSON.parse(readFileSync(sessionFile, "utf8")) as { name: string; value: string };
    response.writeHead(302, {
      "Set-Cookie": `${cookie.name}=${cookie.value}; Path=/; HttpOnly; SameSite=Lax`,
      Location: `http://${DEMO_HOST}:${DEMO_PORTS.web}/`,
    });
    response.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(DEMO_PORTS.adminHelper, DEMO_HOST, () => resolve(server));
  });
}

/** Resolves once `url` answers 200. Rejects after LOGIN_READY_MS, or at once when next dev has already exited. */
async function waitForPage(url: string, hasExited: () => boolean): Promise<void> {
  const deadline = Date.now() + LOGIN_READY_MS;
  while (Date.now() < deadline) {
    if (hasExited()) throw new Error("next dev stopped before the login page answered.");
    try {
      const response = await fetch(url, { redirect: "manual" });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch {
      // Not listening yet. Try again.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not answer 200 within 3 minutes.`);
}

/** The seeded admin session cookie, from the file the seed wrote. */
function readSessionCookie(): { name: string; value: string } {
  const sessionFile = path.join(repoRoot, "demo", "admin-session.json");
  return JSON.parse(readFileSync(sessionFile, "utf8")) as { name: string; value: string };
}

function printSignIns(): void {
  console.log("");
  console.log(`Demo: http://${DEMO_HOST}:${DEMO_PORTS.web}  (127.0.0.1, so your normal localhost dev sign-in is untouched)`);
  console.log(`  Requester: sign in with ${DEMO_REQUESTER.email} / ${DEMO_REQUESTER.password}`);
  console.log(`  Admin:     open http://${DEMO_HOST}:${DEMO_PORTS.adminHelper}/ to sign in as ${DEMO_ADMIN.name} (${DEMO_ADMIN.email}).`);
  console.log("             Don't use \"Admin: sign in with Plex\": the demo is cut off from plex.tv, so it can only fail.");
  console.log("");
}

async function main(): Promise<void> {
  mkdirSync(path.join(repoRoot, "demo"), { recursive: true });
  const catalogue = buildCatalogue(Date.now());
  console.log(
    `demo: ${catalogue.radarr.movies.length} movies, ${catalogue.sonarr.series.length} series, ` +
      `${catalogue.radarr.queue.length + catalogue.sonarr.queue.length} queue items (art cache: ${path.relative(repoRoot, artCacheDir())}).`,
  );

  let fakes: FakeServers;
  try {
    fakes = await startFakeServers({ catalogue, artDir: artCacheDir() });
  } catch (error) {
    console.error(`demo: could not start the fake servers (${error instanceof Error ? error.message : "unknown error"}).`);
    console.error(`demo: check that ports ${DEMO_PORTS.radarr}, ${DEMO_PORTS.sonarr} and ${DEMO_PORTS.plex} are free.`);
    process.exit(1);
  }
  console.log(`demo: fake Radarr on ${fakes.ports.radarr}, fake Sonarr on ${fakes.ports.sonarr}, fake Plex on ${fakes.ports.plex}.`);

  const children: { next?: ChildProcess; helper?: Server } = {};
  let stopping = false;
  const shutdown = async (code: number) => {
    if (stopping) return;
    stopping = true;
    children.next?.kill("SIGINT");
    children.helper?.close();
    await fakes.close();
    process.exit(code);
  };
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  const seedCode = await waitForExit(
    run("npx", ["tsx", "--conditions=react-server", "scripts/demo/seed.ts"], demoEnvironment()),
  );
  if (seedCode !== 0) {
    console.error("demo: the seed failed, so MediaHub was not started.");
    await shutdown(1);
    return;
  }
  // The admin session file is the admin's only way in, so a seed that finished without it is a failure.
  if (!existsSync(path.join(repoRoot, "demo", "admin-session.json"))) {
    console.error("demo: demo/admin-session.json is missing after the seed.");
    await shutdown(1);
    return;
  }

  children.helper = await startAdminHelper();
  printSignIns();
  if (noNext) {
    console.log("demo: --no-next, so MediaHub is not started. The fake servers are running. Ctrl+C to stop.");
    return;
  }

  const startedAt = Date.now();
  // -H binds the demo to loopback only, so other devices on the network can't reach it.
  const next = run("npx", ["next", "dev", "-p", String(DEMO_PORTS.web), "-H", DEMO_HOST], demoEnvironment());
  children.next = next;
  if (screenshots) {
    let exited = false;
    next.on("exit", () => {
      exited = true;
    });
    let code = 0;
    try {
      await waitForPage(`http://${DEMO_HOST}:${DEMO_PORTS.web}/login`, () => exited);
      const { takeScreenshots } = await import("./screenshots");
      await takeScreenshots({
        baseUrl: `http://${DEMO_HOST}:${DEMO_PORTS.web}`,
        catalogue,
        session: readSessionCookie(),
        repoRoot,
        log: (line) => console.log(line),
      });
      console.log("demo: screenshots done.");
    } catch (error) {
      console.error(`demo: screenshots failed: ${error instanceof Error ? error.message : "unexpected error."}`);
      code = 1;
    }
    await shutdown(code);
    return;
  }
  const code = await waitForExit(next);
  if (stopping) return;
  if (Date.now() - startedAt < EARLY_EXIT_MS || code !== 0) {
    console.error(`demo: next dev stopped (exit ${code}). ${NEXT_START_HINT}`);
  }
  await shutdown(code === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`demo: ${error instanceof Error ? error.message : "unexpected error."}`);
  process.exit(1);
});

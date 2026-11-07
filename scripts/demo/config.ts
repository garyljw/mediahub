// Fixed values for the demo stack (npm run demo). Demo only: none of these protect anything real. They are
// written here so the fakes, the seed and the dev server all agree, and so nothing has to be read from .env.local.

export const DEMO_PORTS = {
  radarr: 17878,
  sonarr: 17989,
  plex: 17400,
  web: 3100,
  /** A tiny helper page that signs the browser in as the demo admin. */
  adminHelper: 3101,
} as const;

/**
 * The demo runs on 127.0.0.1, not localhost. Browsers share cookies across ports of the same host, so a demo sign-in
 * on localhost would replace the normal dev server's session. 127.0.0.1 is a different host to the browser.
 */
export const DEMO_HOST = "127.0.0.1";

/**
 * A proxy address nothing listens on. MediaHub runs in the demo with every outside request sent there, so it can't
 * reach plex.tv, TMDB, TVDB or GitHub: only the local fakes (NO_PROXY) answer.
 */
export const DEAD_PROXY = "http://127.0.0.1:9";

/** The key the fake Radarr and Sonarr accept in X-Api-Key. Not a real key. */
export const DEMO_API_KEY = "demo-only-arr-key";

/** The token the fake Plex Media Server accepts in X-Plex-Token. Not a real token. */
export const DEMO_PLEX_TOKEN = "demo-only-plex-token";

export const DEMO_PLEX_SERVER = {
  id: "fake-server-0001",
  name: "Fake Home Server",
  ownerAccountId: "100001",
} as const;

/** The session signing secret for the demo database only. Fixed so the seeded admin cookie stays valid across restarts. */
export const DEMO_AUTH_SECRET = "demo-only-auth-secret-not-for-real-use-0123456789";

export const DEMO_REQUESTER = { name: "Alex", email: "alex@example.test", password: "demo-password" } as const;

export const DEMO_ADMIN = { name: "Sam", email: "admin@example.test" } as const;

/** The cookie Better Auth sets over http (no __Secure- prefix), and the session file the screenshot script reads. */
export const SESSION_COOKIE_NAME = "better-auth.session_token";
